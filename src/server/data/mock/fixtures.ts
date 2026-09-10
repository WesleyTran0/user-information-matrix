/**
 * Fixture dataset.
 *
 * Rows marked "from CLAUDE.md" are copied verbatim from the sample payloads.
 * The rest are synthesized to exercise the cases the samples do not cover:
 * an object type owning two lifecycles (partial coverage), a role shared by
 * two groups (call de-duplication), a grant pointing at an unknown lifecycle
 * (unresolved reporting), and a role with no grants at all.
 */
import type {
  ApiGroupRole,
  ApiKeyedByGroupId,
  ApiObjectLifeCycle,
  ApiObjectType,
  ApiRoleLifeCyclePermission,
  ApiUser,
  ApiUserGroup,
} from '../../../shared/types/resolver-api.ts';

const ORG = 1000;
const CREATED = '2019-12-17T03:25:41.218Z';
const MODIFIED = '2026-09-10T20:41:13.556Z';

export const MOCK_USER_GROUPS: ApiUserGroup[] = [
  {
    // from CLAUDE.md
    id: 280773,
    name: 'Administrator (Vendor Risk Management)',
    description:
      'Join this role to be given entire access to the entire Vendor Risk Management Application, related Object Types, and their workflows. Membership to this role should be temporary.',
    created: CREATED,
    modified: MODIFIED,
    createdBy: 357,
    modifiedBy: null,
    org: ORG,
    externalRefId: '00060d7c-2b96-417b-8af4-56d88654a000',
    scimdisplayname: null,
    numberOfUsers: '2',
  },
  {
    // from CLAUDE.md
    id: 280774,
    name: 'Incident Supervisor',
    description: 'Security team members that are in a lead position and review the work of others.',
    created: '2017-11-29T21:23:14.748Z',
    modified: MODIFIED,
    createdBy: 1068,
    modifiedBy: null,
    org: ORG,
    externalRefId: '003e7179-a1e2-4700-9728-79a1ffc3150b',
    scimdisplayname: null,
    numberOfUsers: '4',
  },
  {
    id: 280775,
    name: 'Risk & Compliance',
    description: 'Risk champions and compliance reviewers across business units.',
    created: '2022-04-24T04:30:57.611Z',
    modified: MODIFIED,
    createdBy: 1068,
    modifiedBy: null,
    org: ORG,
    externalRefId: '00a1c8f2-7d31-4b0a-9f11-2b6ac7a4d001',
    scimdisplayname: null,
    numberOfUsers: '3',
  },
];

const ROLE_VRM_ADMIN: ApiGroupRole = {
  // from CLAUDE.md
  id: 449785,
  name: 'VRM - Administrator ',
  description:
    'Join this role to be given entire access to the entire Vendor Risk Management Program, related Object Types, and their workflows.',
  isGlobal: true,
  created: '2019-12-17T03:24:54.229Z',
  modified: MODIFIED,
  org: ORG,
  externalRefId: '9e9b849c-b02a-4a04-a47c-83bab758ef9e',
};

const ROLE_INCIDENT_OWNER: ApiGroupRole = {
  // from CLAUDE.md
  id: 449698,
  name: 'Incident Owner',
  description:
    'Initiates Incidents in absence of a Triage source or process. Works directly with Incidents that they own and controls content, lifecycle and accessibility.',
  isGlobal: false,
  created: '2017-11-29T21:23:14.748Z',
  modified: MODIFIED,
  org: ORG,
  externalRefId: '0d92869e-a0dd-47e5-a780-1d772144d508',
};

const ROLE_ADDITIONAL_ACCESS: ApiGroupRole = {
  // from CLAUDE.md
  id: 449710,
  name: 'Additional Access',
  description:
    'Incident Management: assigned on an Incident. Grants explicit visibility (Read Only) to a specific incident and its details.',
  isGlobal: false,
  created: '2017-11-29T21:23:14.748Z',
  modified: MODIFIED,
  org: ORG,
  externalRefId: '266b96a9-bd52-4adf-a6d7-6c709aebf5a1',
};

const ROLE_RISK_CHAMPION: ApiGroupRole = {
  // from CLAUDE.md (/user/role sample)
  id: 449680,
  name: 'Risk Champion',
  description:
    'Conduct risk assessments including inherent risk, residual risk, controls, issues and corrective actions. Create new emerging risks. Escalate high priority risks.',
  isGlobal: false,
  created: '2022-04-24T04:30:57.611Z',
  modified: MODIFIED,
  org: ORG,
  externalRefId: '0089b455-9043-4145-a9d2-d1fbec296396',
};

const ROLE_COMMAND_CENTER: ApiGroupRole = {
  // from CLAUDE.md (/user/role sample) -- intentionally has no grants
  id: 449679,
  name: 'Command Center Portal',
  description: '[Not in Use] Used in Command Center App',
  isGlobal: false,
  created: '2018-12-12T18:24:25.149Z',
  modified: MODIFIED,
  org: ORG,
  externalRefId: '003f0fb0-36b3-468d-bc43-9115277d8515',
};

/** Risk Champion and Incident Owner each appear in two groups on purpose. */
export const MOCK_GROUP_ROLES: ApiKeyedByGroupId<ApiGroupRole[]> = {
  '280773': [ROLE_VRM_ADMIN, ROLE_COMMAND_CENTER],
  '280774': [ROLE_INCIDENT_OWNER, ROLE_ADDITIONAL_ACCESS, ROLE_RISK_CHAMPION],
  '280775': [ROLE_RISK_CHAMPION, ROLE_INCIDENT_OWNER],
};

export const MOCK_GROUP_USERS: ApiKeyedByGroupId<ApiUser[]> = {
  '280773': [
    {
      // from CLAUDE.md
      id: 278529,
      first: 'Ada',
      last: 'Lovelace',
      email: 'ada.lovelace@example.com',
      externalRefId: 'b4e34bb8-34d9-4eba-a7ed-15db54130b31',
      isActive: true,
      userType: 0,
      isAdmin: false,
      isPortalUrlAccess: false,
      lastLogin: '2025-08-06T07:11:04.622Z',
      lang: 'en-US',
    },
    {
      // from CLAUDE.md
      id: 89292,
      first: '~RESOLVER_Grace',
      last: 'Hopper',
      email: 'grace.hopper@example.com',
      externalRefId: '144b57e6-ac1b-4cde-a613-85ce15b58564',
      isActive: true,
      userType: 1,
      isAdmin: true,
      isPortalUrlAccess: false,
      lastLogin: '2026-09-10T18:16:56.865Z',
      lang: 'en-US',
    },
  ],
  '280774': [
    {
      // from CLAUDE.md
      id: 92811,
      first: '~RESOLVER_Alan',
      last: 'Turing',
      email: 'alan.turing@example.com',
      externalRefId: '04eb254b-8aea-4b8e-8981-7a97cf14cedf',
      isActive: true,
      userType: 1,
      isAdmin: true,
      isPortalUrlAccess: false,
      lastLogin: '2026-09-10T18:43:16.891Z',
      lang: 'en-US',
    },
    {
      id: 104233,
      first: 'Jean',
      last: 'Bartik',
      email: 'jean.bartik@example.com',
      externalRefId: '5f0b3d21-9c44-4a77-8d1e-6a51c2e7b110',
      isActive: true,
      userType: 0,
      isAdmin: false,
      isPortalUrlAccess: false,
      lastLogin: '2026-08-28T12:02:44.100Z',
      lang: 'en-US',
    },
    {
      id: 118904,
      first: 'Katherine',
      last: 'Johnson',
      email: 'katherine.johnson@example.com',
      externalRefId: '7c9a1f55-2b18-4f60-a3c9-9e0d4471aa32',
      isActive: false,
      userType: 0,
      isAdmin: false,
      isPortalUrlAccess: true,
      lastLogin: '2025-11-14T09:31:18.004Z',
      lang: 'fr-FR',
    },
  ],
  '280775': [
    {
      id: 120551,
      first: 'Grete',
      last: 'Hermann',
      email: 'grete.hermann@example.com',
      externalRefId: 'a1d2e3f4-5678-49ab-bcde-0123456789ab',
      isActive: true,
      userType: 0,
      isAdmin: false,
      isPortalUrlAccess: false,
      lastLogin: '2026-09-02T15:44:09.771Z',
      lang: 'fr-FR',
    },
    {
      id: 278529,
      first: 'Ada',
      last: 'Lovelace',
      email: 'ada.lovelace@example.com',
      externalRefId: 'b4e34bb8-34d9-4eba-a7ed-15db54130b31',
      isActive: true,
      userType: 0,
      isAdmin: false,
      isPortalUrlAccess: false,
      lastLogin: '2025-08-06T07:11:04.622Z',
      lang: 'en-US',
    },
  ],
};

function lifeCycle(
  id: number,
  name: string,
  objectTypeId: number | null,
  stateNames: string[],
  externalRefId: string,
): ApiObjectLifeCycle {
  return {
    id,
    name,
    type: 1,
    nameKey: `app:objectLifeCycle:name:${externalRefId}`,
    description: null,
    descriptionKey: null,
    created: '2017-12-15T06:28:06.519Z',
    modified: '2026-09-10T20:42:26.363Z',
    org: ORG,
    nextStateOrdinal: stateNames.length,
    externalRefId,
    objectTypeId,
    isSystemConfig: false,
    states: stateNames.map((stateName, ordinal) => ({
      id: id * 100 + ordinal,
      name: stateName,
      ordinal,
      objectLifeCycleId: id,
    })),
  };
}

export const MOCK_OBJECT_LIFE_CYCLES: ApiObjectLifeCycle[] = [
  // from CLAUDE.md (ids/names/objectTypeIds), states synthesized
  lifeCycle(603158, 'Financial Statement Account Status', 442982, ['Draft', 'Active', 'Retired'],
    '000d0640-9a65-4e1c-a4f1-008a3822b750'),
  lifeCycle(603159, 'Organization Response', 443023, ['Requested', 'In Progress', 'Submitted', 'Accepted'],
    '0078ccd4-2657-42c0-a43f-31a7a20535e2'),
  // Incident owns two lifecycles -> partial coverage is reachable
  lifeCycle(603174, 'Incident Workflow', 450001,
    ['Triage', 'Open', 'Investigation', 'Review', 'Closed'],
    '01aa1111-1111-4111-8111-111111111111'),
  lifeCycle(603272, 'Incident Escalation', 450001, ['Raised', 'Escalated', 'Resolved'],
    '02bb2222-2222-4222-8222-222222222222'),
  lifeCycle(992693, 'Corrective Action Status', 450002,
    ['Planned', 'In Progress', 'Verification', 'Complete'],
    '03cc3333-3333-4333-8333-333333333333'),
  lifeCycle(710789, 'Cyber Control Assessment', 522608, ['Not Assessed', 'Assessed', 'Remediation'],
    '04dd4444-4444-4444-8444-444444444444'),
  lifeCycle(946843, 'Territory Group Status', 699361, ['Active', 'Inactive'],
    '05ee5555-5555-4555-8555-555555555555'),
  // Bound to no object type -> exercises the unresolved path
  lifeCycle(999001, 'Unbound Legacy Workflow', null, ['Start', 'End'],
    '06ff6666-6666-4666-8666-666666666666'),
];

function objectType(
  id: number,
  name: string,
  pluralName: string,
  monogram: string,
  color: string,
  objectLifeCycleId: number | null,
  description: string,
  isLibraryObjectType = false,
): ApiObjectType {
  return {
    id,
    name,
    pluralName,
    description,
    monogram,
    nameKey: null,
    descriptionKey: null,
    pluralNameKey: null,
    monogramKey: null,
    color,
    objectLifeCycleId,
    externalRefId: `objtype-${id}`,
    created: '2024-06-24T16:02:18.020Z',
    modified: '2026-09-10T20:42:26.363Z',
    nextElement: 1,
    org: ORG,
    assessment: false,
    anchor: null,
    anchorRelationship: null,
    dataDefinitionId: null,
    retentionEnabled: false,
    isSystemConfig: false,
    isLibraryObjectType,
  };
}

export const MOCK_OBJECT_TYPES: ApiObjectType[] = [
  objectType(442982, 'Financial Statement Account', 'Financial Statement Accounts', 'FSA', '#7c6cd4',
    603158, 'Accounts referenced by financial control testing.'),
  objectType(443023, 'Organization', 'Organizations', 'ORG', '#4a9d5f', 603159,
    'Third-party organizations assessed by the VRM program.'),
  objectType(450001, 'Incident', 'Incidents', 'INC', '#d4574a', 603174,
    'Negative events tracked through triage, investigation and closure.'),
  objectType(450002, 'Corrective Action', 'Corrective Actions', 'CA', '#d49a35', 992693,
    'Remediation work tracked against incidents, risks and controls.'),
  // from CLAUDE.md
  objectType(522608, 'Cyber Control', 'Cyber Controls', 'CK', '#35add4', 710789,
    'Cyber KICs object used as the primary assessment object in the Cyber KICs Assessment', true),
  // from CLAUDE.md
  objectType(699361, 'Territory Local Representative Group', 'Territory Local Representative Groups',
    'TLR', '#5f7fd4', 946843, 'Territory-scoped representative groupings.'),
];

/**
 * Grants keyed by role id, mirroring
 * /data/rolePermissions/objectLifeCycles/role/{roleId}.
 *
 * 449680 references lifecycle 888888 which is not in the catalog, and 999001
 * which is bound to no object type -- both should surface as unresolved.
 */
export const MOCK_ROLE_LIFE_CYCLE_PERMISSIONS: Record<number, ApiRoleLifeCyclePermission[]> = {
  449785: [603158, 603159, 710789, 946843, 603174, 603272, 992693].map((id) => ({
    objectLifeCycleId: id,
  })),
  449698: [603174, 992693].map((id) => ({ objectLifeCycleId: id })),
  449710: [603174].map((id) => ({ objectLifeCycleId: id })),
  449680: [710789, 603272, 999001, 888888].map((id) => ({ objectLifeCycleId: id })),
  449679: [],
};
