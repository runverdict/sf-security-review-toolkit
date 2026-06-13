/**
 * Post-install handler template for an MCP server registration managed
 * package. Replace `MyMCP` with your MCP name ({MCP_NAME}) throughout;
 * the namespace ({NAMESPACE}) is resolved at runtime — no edits needed.
 *
 * Works around a Salesforce known issue (see the MCP Client Partner Technical Guide): a packaged permission
 * set's Read grant on the `UserExternalCredential` object is silently
 * dropped during subscriber install, which leaves the Agentforce runtime
 * unable to resolve the External Credential principal and the MCP tools
 * never appear in the Enabled Tools list / Plan Tracer.
 *
 * Responsibilities (each step is idempotent — re-runs and upgrades skip
 * work that is already in place):
 *   1. Assign the packaged permission set (`MyMCP_Perm_Set`) to the user
 *      who initiated the install.
 *   2. Resolve the Platform Integration User and assign the same
 *      permission set to that user so the server-to-server MCP callout has
 *      the External Credential principal access it needs (the integration
 *      user is what actually makes the egress callout at runtime).
 *   3. Verify the packaged permission set actually carries read access on
 *      the `UserExternalCredential` object. If the deployed permission set
 *      is missing that grant (the known-issue symptom), create a fallback
 *      permission set with that single grant and assign it to both users.
 *
 * Implemented as `global without sharing` because Salesforce requires the
 * InstallHandler entry point to be `global` (the platform invokes
 * onInstall cross-namespace, as a special package system user — NOT the
 * installer) and the work performed here must succeed regardless of the
 * installing user's sharing rules.
 *
 * Note on upgrades: InstallContext also exposes `previousVersion()`
 * (a three-part Version, null on first install) and `isUpgrade()` for
 * version-gated migrations. This handler is deliberately branch-free —
 * every step is idempotent, so first install and upgrade take the same
 * path. Add the `if (context.previousVersion() == null) { ... } else if
 * (context.isUpgrade()) { ... }` branching only when you need a
 * version-specific migration.
 *
 * Mirrors the reference implementation GoogleMapsMCPPostInstall.cls
 * (https://github.com/mvogelgesang/sf-mcp-registration-api-key), with
 * one hardening on top — the namespace-aware permission set lookup in
 * findPermissionSetIdByName.
 */
global without sharing class MCPPostInstall implements InstallHandler {
  @TestVisible
  private static String packagePermSetName = 'MyMCP_Perm_Set';

  @TestVisible
  private static String fallbackPermSetName = 'MyMCP_UEC_Access';

  @TestVisible
  private static String fallbackPermSetLabel = 'MyMCP - UserExternalCredential Read (Post-Install)';

  /**
   * The Platform Integration User follows a deterministic naming convention
   * scoped to each org:
   *   Username = `cloud@{18-character org id, lowercased}`
   *   Email    = `noreply@{18-character org id, lowercased}`
   * Matching on this convention avoids the false positives we would hit by
   * filtering on a `Name LIKE 'Platform%'` style query when a subscriber org
   * happens to have other users whose names start with "Platform".
   */
  @TestVisible
  private static final String INTEGRATION_USERNAME_PREFIX = 'cloud@';

  @TestVisible
  private static final String INTEGRATION_EMAIL_PREFIX = 'noreply@';

  /** Optional overrides used by tests to avoid colliding with the real
   *  Platform Integration User (whose Username is globally unique). */
  @TestVisible
  private static String integrationUsernameOverride;

  @TestVisible
  private static String integrationEmailOverride;

  private static final String UEC_SOBJECT = 'UserExternalCredential';

  global void onInstall(InstallContext context) {
    Set<Id> userIds = collectTargetUsers(context.installerId());

    Id packagePermSetId = findPermissionSetIdByName(packagePermSetName);
    if (packagePermSetId != null) {
      assignPermissionSet(packagePermSetId, userIds);
    }

    Boolean hasUecRead =
      packagePermSetId != null &&
      permissionSetHasObjectRead(packagePermSetId, UEC_SOBJECT);

    if (!hasUecRead) {
      Id fallbackId = ensureFallbackPermissionSet();
      if (fallbackId != null) {
        assignPermissionSet(fallbackId, userIds);
      }
    }
  }

  @TestVisible
  private Set<Id> collectTargetUsers(Id installerId) {
    Set<Id> users = new Set<Id>();
    if (installerId != null) {
      users.add(installerId);
    }
    Id integrationUserId = findPlatformIntegrationUserId();
    if (integrationUserId != null) {
      users.add(integrationUserId);
    }
    return users;
  }

  @TestVisible
  private Id findPlatformIntegrationUserId() {
    String expectedUsername = getIntegrationUsername();
    String expectedEmail = getIntegrationEmail();

    List<User> byUsername = [
      SELECT Id
      FROM User
      WHERE IsActive = TRUE AND Username = :expectedUsername
      LIMIT 1
    ];
    if (!byUsername.isEmpty()) {
      return byUsername[0].Id;
    }

    List<User> byEmail = [
      SELECT Id
      FROM User
      WHERE IsActive = TRUE AND Email = :expectedEmail
      LIMIT 1
    ];
    return byEmail.isEmpty() ? null : byEmail[0].Id;
  }

  @TestVisible
  private static String getIntegrationUsername() {
    if (integrationUsernameOverride != null) {
      return integrationUsernameOverride;
    }
    return INTEGRATION_USERNAME_PREFIX + getOrgId18Lower();
  }

  @TestVisible
  private static String getIntegrationEmail() {
    if (integrationEmailOverride != null) {
      return integrationEmailOverride;
    }
    return INTEGRATION_EMAIL_PREFIX + getOrgId18Lower();
  }

  @TestVisible
  private static String getOrgId18Lower() {
    // Casting through Id guarantees the 18-character form even if the
    // underlying API returned a 15-character id.
    Id orgId = UserInfo.getOrganizationId();
    return String.valueOf(orgId).toLowerCase();
  }

  /**
   * The namespace this class is packaged under, derived from the runtime
   * class name (`{NAMESPACE}.MCPPostInstall` in a subscriber org, bare
   * `MCPPostInstall` in a namespace-less dev deploy). Used to disambiguate
   * the packaged permission set from any subscriber-local permission set
   * that happens to share its developer name — a real collision we have
   * seen in the wild.
   */
  @TestVisible
  private static String getPackageNamespace() {
    String fullName = String.valueOf(MCPPostInstall.class);
    return fullName.contains('.') ? fullName.substringBefore('.') : null;
  }

  @TestVisible
  private Id findPermissionSetIdByName(String developerName) {
    String ns = getPackageNamespace();
    if (ns != null) {
      List<PermissionSet> namespaced = [
        SELECT Id
        FROM PermissionSet
        WHERE Name = :developerName AND NamespacePrefix = :ns
        LIMIT 1
      ];
      if (!namespaced.isEmpty()) {
        return namespaced[0].Id;
      }
    }
    List<PermissionSet> sets = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = :developerName AND NamespacePrefix = null
      LIMIT 1
    ];
    return sets.isEmpty() ? null : sets[0].Id;
  }

  @TestVisible
  private Boolean permissionSetHasObjectRead(Id permSetId, String sobjectType) {
    List<ObjectPermissions> perms = [
      SELECT Id
      FROM ObjectPermissions
      WHERE
        ParentId = :permSetId
        AND SobjectType = :sobjectType
        AND PermissionsRead = TRUE
      LIMIT 1
    ];
    return !perms.isEmpty();
  }

  @TestVisible
  private Id ensureFallbackPermissionSet() {
    Id existingId = findPermissionSetIdByName(fallbackPermSetName);
    if (existingId != null) {
      if (!permissionSetHasObjectRead(existingId, UEC_SOBJECT)) {
        insertUecReadPermission(existingId);
      }
      return existingId;
    }

    PermissionSet ps = new PermissionSet(
      Name = fallbackPermSetName,
      Label = fallbackPermSetLabel,
      Description = 'Auto-generated by the MyMCP post-install handler to ensure UserExternalCredential read access when the packaged permission set is missing it (Salesforce known issue: install-time UEC grant drop).'
    );
    Database.SaveResult psResult = Database.insert(ps, false);
    if (!psResult.isSuccess()) {
      return null;
    }

    insertUecReadPermission(ps.Id);
    return ps.Id;
  }

  private void insertUecReadPermission(Id permSetId) {
    ObjectPermissions op = new ObjectPermissions(
      ParentId = permSetId,
      SobjectType = UEC_SOBJECT,
      PermissionsRead = true,
      PermissionsCreate = false,
      PermissionsEdit = false,
      PermissionsDelete = false,
      PermissionsViewAllRecords = false,
      PermissionsModifyAllRecords = false
    );
    Database.insert(op, false);
  }

  @TestVisible
  private void assignPermissionSet(Id permSetId, Set<Id> userIds) {
    if (permSetId == null || userIds == null || userIds.isEmpty()) {
      return;
    }

    Set<Id> alreadyAssigned = new Set<Id>();
    for (PermissionSetAssignment psa : [
      SELECT AssigneeId
      FROM PermissionSetAssignment
      WHERE PermissionSetId = :permSetId AND AssigneeId IN :userIds
    ]) {
      alreadyAssigned.add(psa.AssigneeId);
    }

    List<PermissionSetAssignment> toCreate = new List<PermissionSetAssignment>();
    for (Id uid : userIds) {
      if (!alreadyAssigned.contains(uid)) {
        toCreate.add(
          new PermissionSetAssignment(
            AssigneeId = uid,
            PermissionSetId = permSetId
          )
        );
      }
    }

    if (!toCreate.isEmpty()) {
      Database.insert(toCreate, false);
    }
  }
}
