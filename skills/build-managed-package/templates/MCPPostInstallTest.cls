/**
 * Tests for {@link MCPPostInstall}. Replace `MyMCP` with your MCP name
 * ({MCP_NAME}) to match the handler — no namespace edits needed.
 *
 * The Platform Integration User is identified by the deterministic
 * `cloud@{orgId18}` Username and `noreply@{orgId18}` Email convention.
 * To keep tests independent of whatever real Platform Integration User
 * lives in the running org (whose Username is globally unique and
 * therefore can't be replicated in a fixture), each test creates a
 * stand-in user with a known Username/Email pair and points the
 * `integrationUsernameOverride` / `integrationEmailOverride` statics
 * at it.
 *
 * Lifecycle is driven through `Test.testInstall(...)` — the supported
 * simulation hook. The installer id resolves via UserInfo.getUserId();
 * InstallContext fields are not directly mockable.
 */
@IsTest
private class MCPPostInstallTest {
  private static final String FAKE_USERNAME = 'cloud@mcptest000000000aaa.invalid';
  private static final String FAKE_EMAIL = 'noreply@mcptest000000000aaa.invalid';
  private static final String FAKE_EMAIL_ONLY_USERNAME = 'unrelated.user@mcptest.invalid';
  private static final String FAKE_PACKAGE_PERMSET = 'mcpTestPackagePermSet';
  private static final String FAKE_PACKAGE_PERMSET_WITH_UEC = 'mcpTestPackagePermSetUEC';

  @TestSetup
  static void setupTestData() {
    Profile standard = [
      SELECT Id
      FROM Profile
      WHERE Name = 'Standard User'
      LIMIT 1
    ];

    User integrationStandIn = new User(
      FirstName = 'Cloud',
      LastName = 'MCPTest Integration',
      Email = FAKE_EMAIL,
      Username = FAKE_USERNAME,
      Alias = 'cmcpt',
      TimeZoneSidKey = 'America/Los_Angeles',
      LocaleSidKey = 'en_US',
      EmailEncodingKey = 'UTF-8',
      LanguageLocaleKey = 'en_US',
      ProfileId = standard.Id
    );
    insert integrationStandIn;

    PermissionSet permSetWithoutUec = new PermissionSet(
      Name = FAKE_PACKAGE_PERMSET,
      Label = 'MCP Test Package PermSet (no UEC)'
    );
    insert permSetWithoutUec;

    PermissionSet permSetWithUec = new PermissionSet(
      Name = FAKE_PACKAGE_PERMSET_WITH_UEC,
      Label = 'MCP Test Package PermSet (with UEC)'
    );
    insert permSetWithUec;

    insert new ObjectPermissions(
      ParentId = permSetWithUec.Id,
      SobjectType = 'UserExternalCredential',
      PermissionsRead = true
    );
  }

  @IsTest
  static void onInstall_assignsPackagePermSetWhenItAlreadyHasUecRead() {
    configureForUsernameLookup(FAKE_PACKAGE_PERMSET_WITH_UEC);

    Id packagePermSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :FAKE_PACKAGE_PERMSET_WITH_UEC
      LIMIT 1
    ]
    .Id;
    Id installerId = UserInfo.getUserId();
    Id integrationUserId = [
      SELECT Id
      FROM User
      WHERE Username = :FAKE_USERNAME
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    Set<Id> assignees = collectAssignees(packagePermSetId);
    System.assert(
      assignees.contains(installerId),
      'Installer should be assigned the package permission set.'
    );
    System.assert(
      assignees.contains(integrationUserId),
      'Platform Integration stand-in user should be assigned the package permission set.'
    );

    System.assertEquals(
      0,
      countPermSetByName(MCPPostInstall.fallbackPermSetName),
      'Fallback permission set should not be created when the package perm set already has UEC read.'
    );
  }

  @IsTest
  static void onInstall_freshInstall_runsSamePathAsUpgrade() {
    // previousVersion = null simulates a FIRST install; every other test
    // passes new Version(1, 0), which simulates an upgrade from 1.0. The
    // handler is deliberately branch-free, so both must land the same state.
    configureForUsernameLookup(FAKE_PACKAGE_PERMSET_WITH_UEC);

    Id packagePermSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :FAKE_PACKAGE_PERMSET_WITH_UEC
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), null);
    Test.stopTest();

    Set<Id> assignees = collectAssignees(packagePermSetId);
    System.assert(
      assignees.contains(UserInfo.getUserId()),
      'Fresh install (null previousVersion) should assign the package permission set to the installer.'
    );
    System.assertEquals(
      0,
      countPermSetByName(MCPPostInstall.fallbackPermSetName),
      'Fresh install should not create the fallback when the package perm set already has UEC read.'
    );
  }

  @IsTest
  static void onInstall_createsFallbackWhenPackagePermSetMissingUecRead() {
    configureForUsernameLookup(FAKE_PACKAGE_PERMSET);

    Id installerId = UserInfo.getUserId();
    Id integrationUserId = [
      SELECT Id
      FROM User
      WHERE Username = :FAKE_USERNAME
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    List<PermissionSet> fallbacks = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :MCPPostInstall.fallbackPermSetName
    ];
    System.assertEquals(
      1,
      fallbacks.size(),
      'Exactly one fallback permission set should be created when the package perm set lacks UEC read.'
    );

    Id fallbackId = fallbacks[0].Id;
    List<ObjectPermissions> uec = [
      SELECT Id
      FROM ObjectPermissions
      WHERE
        ParentId = :fallbackId
        AND SobjectType = 'UserExternalCredential'
        AND PermissionsRead = TRUE
    ];
    System.assertEquals(
      1,
      uec.size(),
      'Fallback permission set should grant read on UserExternalCredential.'
    );

    Set<Id> fallbackAssignees = collectAssignees(fallbackId);
    System.assert(
      fallbackAssignees.contains(installerId),
      'Installer should be assigned the fallback permission set.'
    );
    System.assert(
      fallbackAssignees.contains(integrationUserId),
      'Platform Integration stand-in user should be assigned the fallback permission set.'
    );
  }

  @IsTest
  static void onInstall_isIdempotentOnSecondRun() {
    configureForUsernameLookup(FAKE_PACKAGE_PERMSET_WITH_UEC);

    Id packagePermSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :FAKE_PACKAGE_PERMSET_WITH_UEC
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Integer firstRunAssignmentCount = countAssignments(packagePermSetId);
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Integer secondRunAssignmentCount = countAssignments(packagePermSetId);
    Test.stopTest();

    System.assertEquals(
      firstRunAssignmentCount,
      secondRunAssignmentCount,
      'Re-running the post-install must not create duplicate permission set assignments.'
    );
  }

  @IsTest
  static void onInstall_reusesExistingFallbackPermissionSet() {
    configureForUsernameLookup(FAKE_PACKAGE_PERMSET);

    PermissionSet preExisting = new PermissionSet(
      Name = MCPPostInstall.fallbackPermSetName,
      Label = 'Pre-existing fallback'
    );
    insert preExisting;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    Integer fallbackCount = countPermSetByName(
      MCPPostInstall.fallbackPermSetName
    );
    System.assertEquals(
      1,
      fallbackCount,
      'When a fallback perm set already exists, no duplicate should be created.'
    );

    List<ObjectPermissions> uec = [
      SELECT Id
      FROM ObjectPermissions
      WHERE
        ParentId = :preExisting.Id
        AND SobjectType = 'UserExternalCredential'
        AND PermissionsRead = TRUE
    ];
    System.assertEquals(
      1,
      uec.size(),
      'Existing fallback perm set should be back-filled with UserExternalCredential read access.'
    );

    Set<Id> assignees = collectAssignees(preExisting.Id);
    System.assert(
      assignees.contains(UserInfo.getUserId()),
      'Installer should be assigned the existing fallback permission set.'
    );
  }

  @IsTest
  static void onInstall_skipsIntegrationUserAssignmentWhenNoneMatches() {
    MCPPostInstall.packagePermSetName = FAKE_PACKAGE_PERMSET_WITH_UEC;
    MCPPostInstall.integrationUsernameOverride = 'cloud@no-such-org-id-zzzzz.invalid';
    MCPPostInstall.integrationEmailOverride = 'noreply@no-such-org-id-zzzzz.invalid';

    Id packagePermSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :FAKE_PACKAGE_PERMSET_WITH_UEC
      LIMIT 1
    ]
    .Id;
    Id installerId = UserInfo.getUserId();

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    Set<Id> assignees = collectAssignees(packagePermSetId);
    System.assert(
      assignees.contains(installerId),
      'Installer should still be assigned even when no integration user matches.'
    );
    System.assertEquals(
      1,
      assignees.size(),
      'Only the installer should be assigned when no Platform Integration User is found.'
    );
  }

  @IsTest
  static void onInstall_findsUserByEmailWhenUsernameDoesNotMatch() {
    // Insert a user whose Username does NOT match the cloud@ convention
    // but whose Email DOES match the noreply@ convention.
    Profile standard = [
      SELECT Id
      FROM Profile
      WHERE Name = 'Standard User'
      LIMIT 1
    ];
    User emailOnly = new User(
      FirstName = 'Email',
      LastName = 'Only MCPTest',
      Email = 'noreply@email-only-test.invalid',
      Username = FAKE_EMAIL_ONLY_USERNAME,
      Alias = 'emonly',
      TimeZoneSidKey = 'America/Los_Angeles',
      LocaleSidKey = 'en_US',
      EmailEncodingKey = 'UTF-8',
      LanguageLocaleKey = 'en_US',
      ProfileId = standard.Id
    );
    insert emailOnly;

    MCPPostInstall.packagePermSetName = FAKE_PACKAGE_PERMSET_WITH_UEC;
    MCPPostInstall.integrationUsernameOverride = 'cloud@nope-not-the-username.invalid';
    MCPPostInstall.integrationEmailOverride = 'noreply@email-only-test.invalid';

    Id packagePermSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :FAKE_PACKAGE_PERMSET_WITH_UEC
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    Set<Id> assignees = collectAssignees(packagePermSetId);
    System.assert(
      assignees.contains(emailOnly.Id),
      'When Username does not match but Email does, the integration user should still be assigned.'
    );
  }

  @IsTest
  static void onInstall_handlesMissingPackagePermSetByCreatingFallback() {
    MCPPostInstall.packagePermSetName = 'Does_Not_Exist_MCPTest';
    MCPPostInstall.integrationUsernameOverride = FAKE_USERNAME;
    MCPPostInstall.integrationEmailOverride = FAKE_EMAIL;

    Test.startTest();
    Test.testInstall(new MCPPostInstall(), new Version(1, 0));
    Test.stopTest();

    List<PermissionSet> fallbacks = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :MCPPostInstall.fallbackPermSetName
    ];
    System.assertEquals(
      1,
      fallbacks.size(),
      'Fallback should be created when the named package perm set is not present.'
    );

    Set<Id> assignees = collectAssignees(fallbacks[0].Id);
    System.assert(
      assignees.contains(UserInfo.getUserId()),
      'Installer should be assigned the fallback when the package perm set is missing.'
    );
  }

  @IsTest
  static void getIntegrationUsername_buildsCloudConventionFromOrgId() {
    MCPPostInstall.integrationUsernameOverride = null;

    String expected =
      'cloud@' + String.valueOf(UserInfo.getOrganizationId()).toLowerCase();
    System.assertEquals(
      expected,
      MCPPostInstall.getIntegrationUsername(),
      'Computed integration username should follow cloud@{orgId18-lowercase} convention.'
    );
  }

  @IsTest
  static void getIntegrationEmail_buildsNoreplyConventionFromOrgId() {
    MCPPostInstall.integrationEmailOverride = null;

    String expected =
      'noreply@' + String.valueOf(UserInfo.getOrganizationId()).toLowerCase();
    System.assertEquals(
      expected,
      MCPPostInstall.getIntegrationEmail(),
      'Computed integration email should follow noreply@{orgId18-lowercase} convention.'
    );
  }

  @IsTest
  static void getOrgId18Lower_isAlwaysEighteenLowercaseCharacters() {
    String orgId = MCPPostInstall.getOrgId18Lower();
    System.assertEquals(
      18,
      orgId.length(),
      'Org id helper must return the 18-character form.'
    );
    System.assertEquals(
      orgId.toLowerCase(),
      orgId,
      'Org id helper must return a lowercase value to match the platform user convention.'
    );
  }

  /** Common configuration helper: target the test perm set fixture and
   *  point the integration-user lookup at the @TestSetup stand-in user.
   */
  private static void configureForUsernameLookup(String permSetName) {
    MCPPostInstall.packagePermSetName = permSetName;
    MCPPostInstall.integrationUsernameOverride = FAKE_USERNAME;
    MCPPostInstall.integrationEmailOverride = FAKE_EMAIL;
  }

  private static Set<Id> collectAssignees(Id permSetId) {
    Set<Id> assignees = new Set<Id>();
    for (PermissionSetAssignment psa : [
      SELECT AssigneeId
      FROM PermissionSetAssignment
      WHERE PermissionSetId = :permSetId
    ]) {
      assignees.add(psa.AssigneeId);
    }
    return assignees;
  }

  private static Integer countAssignments(Id permSetId) {
    return [
      SELECT COUNT()
      FROM PermissionSetAssignment
      WHERE PermissionSetId = :permSetId
    ];
  }

  private static Integer countPermSetByName(String developerName) {
    return [SELECT COUNT() FROM PermissionSet WHERE Name = :developerName];
  }
}
