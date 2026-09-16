> **Redaction note.** The JSON samples below are real responses, with the
> personal details replaced: names and email addresses are fictional
> (@example.com) and the org id is a placeholder. Endpoint paths, payload
> shapes, ids and relationships are untouched, so the samples remain an
> accurate specification.

### User Groups

endpoint: "/user/group" (no params)

json result from endpoint:

`json
{
  "data": [
    {
      "id": 280773, 
      "name": "Administrator (Vendor Risk Management)",
      "description": "Join this role to be given entire access to the entire Vendor Risk Management Application, related Object Types, and their workflows. All forms will display all possible fields, formulas, relationships, references, and actions. This role will also have access to archived Object Types,  \n\nMembership to this role should be temporary.\n\n",
      "created": "2019-12-17T03:25:41.218Z",
      "modified": "2026-09-10T20:41:13.556Z",
      "createdBy": 357,
      "modifiedBy": null,
      "org": 1000,
      "externalRefId": "00060d7c-2b96-417b-8af4-56d88654a000",
      "scimdisplayname": null,
      "numberOfUsers": "2"
    },
    {
      "id": 280774,
      "name": "Incident Supervisor",
      "description": "Security team members that are in a lead position and review the work of others.",
      "created": "2017-11-29T21:23:14.748Z",
      "modified": "2026-09-10T20:41:13.556Z",
      "createdBy": 1068,
      "modifiedBy": null,
      "org": 1000,
      "externalRefId": "003e7179-a1e2-4700-9728-79a1ffc3150b",
      "scimdisplayname": null,
      "numberOfUsers": "4"
    },
	...
}
`

In this json structure, the id corresponds to the id of each role

### Roles in each Groups

endpoint: "/user/group/roles" (no params)

json result from endpoint
`json
{
  "data": {
    "280773": [
      {
        "id": 449785,
        "name": "VRM - Administrator ",
        "description": "Join this role to be given entire access to the entire Vendor Risk Management Program, related Object Types, and their workflows. All forms will display all possible fields, formulas, relationships, references, and actions. This role will also have access to archived Object Types.\n\n",
        "isGlobal": true,
        "created": "2019-12-17T03:24:54.229Z",
        "modified": "2026-09-10T20:41:13.556Z",
        "org": 1000,
        "externalRefId": "9e9b849c-b02a-4a04-a47c-83bab758ef9e"
      }
    ],
    "280774": [
      {
        "id": 449698,
        "name": "Incident Owner",
        "description": "•\tInitiates Incidents in absence of a Triage source or process\n•\tReceives emails on assigned Incidents from Triage\n•\tGenerally, works with all assigned Incidents in Open status\n•\tWorks directly with Incidents that they are an owner with and control content, lifecycle and accessibility.\n•\tIdentifies or validates key facts and documents those facts on the incident (involvements, loss/recovery, data links)\n•\tPerforms light investigations on a single negative event (self-assigns Investigator)\n•\tCompletes light RCA (Root Cause Analysis) and produces detailed Incident Report\n•\tManages incident-level tasks and corrective actions.\n•\tRuns standard aggregation reports for Incidents they have visibility to.\n•\tKey Forms: Incident – IM – 3 – Triage – New/Edit, Incident – IM – 5 – Full - New, Incident – IM - 6 - Full – Edit, Incident – IM – 7 – Investigation – Edit, Incident – IM – 9 – Details Navigation",
        "isGlobal": false,
        "created": "2017-11-29T21:23:14.748Z",
        "modified": "2026-09-10T20:41:13.556Z",
        "org": 1000,
        "externalRefId": "0d92869e-a0dd-47e5-a780-1d772144d508"
      },
      {
        "id": 449710,
        "name": "Additional Access",
        "description": "Incident Management\n•\tAssigned on an Incident\n•\tGrants explicit visibility (Read Only) to specific incident and details",
        "isGlobal": false,
        "created": "2017-11-29T21:23:14.748Z",
        "modified": "2026-09-10T20:41:13.556Z",
        "org": 1000,
        "externalRefId": "266b96a9-bd52-4adf-a6d7-6c709aebf5a1"
      },
	  ....
	}
	...
}
`
In this json structure, data stores more json objects represented by ids. These ids correspond to group ids. Each group id is its own json structure and describes the list of roles within the group. 

*A role can be in multiple groups*

### Users in Groups

endpoint: "/user/group/users"

json structure in endpoint
`json

  "data": {
    "280773": [
      {
        "id": 278529,
        "first": "Ada",
        "last": "Lovelace",
        "email": "ada.lovelace@example.com",
        "externalRefId": "b4e34bb8-34d9-4eba-a7ed-15db54130b31",
        "isActive": true,
        "userType": 0,
        "isAdmin": false,
        "isPortalUrlAccess": false,
        "lastLogin": "2025-08-06T07:11:04.622Z",
        "lang": "en-US"
      },
      {
        "id": 89292,
        "first": "~RESOLVER_Grace",
        "last": "Hopper",
        "email": "grace.hopper@example.com",
        "externalRefId": "144b57e6-ac1b-4cde-a613-85ce15b58564",
        "isActive": true,
        "userType": 1,
        "isAdmin": true,
        "isPortalUrlAccess": false,
        "lastLogin": "2026-09-10T18:16:56.865Z",
        "lang": "en-US"
      }
    ],
    "280774": [
      {
        "id": 92811,
        "first": "~RESOLVER_Alan",
        "last": "Turing",
        "email": "alan.turing@example.com",
        "externalRefId": "04eb254b-8aea-4b8e-8981-7a97cf14cedf",
        "isActive": true,
        "userType": 1,
        "isAdmin": true,
        "isPortalUrlAccess": false,
        "lastLogin": "2026-09-10T18:43:16.891Z",
        "lang": "en-US"
      },
	 ....
   },
   ....
}
`

This is a similar strucutre to the previous one, where data holds json structures key'd by the group id. Each group id keys structures that represent a single user.

*A user can be in multiple groups and have multiple roles*

### Role (may not be useful since we can already get all roles from looking at all groups)

endpoint: "/user/role"

json structure from endpoint
`json
{
  "data": [
    {
      "id": 449679,
      "name": "Command Center Portal",
      "description": "[Not in Use] Used in Command Center App",
      "nameKey": "app:role:name:ecc6174c-86e6-48a5-b37f-1236e9a954e0",
      "descriptionKey": "app:role:description:c2640b98-297d-4564-8a19-ebf0b7700778",
      "isGlobal": false,
      "created": "2018-12-12T18:24:25.149Z",
      "modified": "2026-09-10T20:41:13.556Z",
      "org": 1000,
      "externalRefId": "003f0fb0-36b3-468d-bc43-9115277d8515",
      "canPerformSearch": true,
      "canQuickCreate": false,
      "canGetHelp": true,
      "canSearchArchive": false
    },
    {
      "id": 449680,
      "name": "Risk Champion",
      "description": "Risk Management\n•\tConduct risk assessment including, documenting inherent risk, residual risk, controls, issues and corrective actions \n•\tCreate new emerging risks\n•\tEscalate high priority risks",
      "nameKey": "app:role:name:c2102ff9-8ddd-45f5-acd7-367b14fe4783",
      "descriptionKey": "app:role:description:75a472db-434e-4ac1-a3c0-a5b58ef8bc6a",
      "isGlobal": false,
      "created": "2022-04-24T04:30:57.611Z",
      "modified": "2026-09-10T20:41:13.556Z",
      "org": 1000,
      "externalRefId": "0089b455-9043-4145-a9d2-d1fbec296396",
      "canPerformSearch": true,
      "canQuickCreate": false,
      "canGetHelp": true,
      "canSearchArchive": false
    },
	...
}
`

### ObjectLifeCycles

endpoint: "/object/objectLifeCycle?includeStates={bool}" (optional param to include states)

json structure from endpoint (without includingStates: includeStates=false)
`json
{
  "data": [
    {
      "id": 603158,
      "name": "Financial Statement Account Status",
      "type": 1,
      "nameKey": "app:objectLifeCycle:name:3b68802d-34c7-48c5-9654-72a479ed5676",
      "description": null,
      "descriptionKey": "app:objectLifeCycle:description:ec8fa633-6de9-4fe0-818c-13c5b04f9d34",
      "created": "2017-12-15T06:28:06.519Z",
      "modified": "2026-09-10T20:42:26.363Z",
      "org": 1000,
      "nextStateOrdinal": 2,
      "externalRefId": "000d0640-9a65-4e1c-a4f1-008a3822b750",
      "objectTypeId": 442982,
      "isSystemConfig": false
    },
    {
      "id": 603159,
      "name": "Organization Response",
      "type": 1,
      "nameKey": "app:objectLifeCycle:name:2768947b-e5de-49cf-997e-23f5135c363b",
      "description": null,
      "descriptionKey": "app:objectLifeCycle:description:11428840-7d1a-4a71-833c-8e0f9c6053dd",
      "created": "2018-09-06T19:36:40.472Z",
      "modified": "2026-09-10T20:42:26.363Z",
      "org": 1000,
      "nextStateOrdinal": 0,
      "externalRefId": "0078ccd4-2657-42c0-a43f-31a7a20535e2",
      "objectTypeId": 443023,
      "isSystemConfig": false
    },
	...
}
`

### ObjectType

endpoint: "/object/objectType" (no params)

json structure from endpoint
`json
{
    "data": [
        {
            "id": 699361,
            "name": "Territory Local Representative Group",
            "pluralName": "Territory Local Representative Groups",
            "description": "",
            "monogram": "TLR",
            "nameKey": "app:objectType:name:855cf85c-f956-4390-ba3f-f4af30b030b3",
            "descriptionKey": "app:objectType:description:02d9aa96-c126-47c7-a7ec-8a7f37ab7ee5",
            "pluralNameKey": "app:objectType:pluralName:5efdc25e-8cb8-4286-98f5-9192933de85c",
            "monogramKey": "app:objectType:monogram:f8c4f8f7-d114-4661-a48b-6d34793b37b9",
            "color": "",
            "objectLifeCycleId": 946843,
            "externalRefId": "04cee60c-3d8c-4a06-8bf5-466d2780829f",
            "created": "2025-10-13T05:14:34.320Z",
            "modified": "2026-09-10T20:42:26.363Z",
            "nextElement": 1,
            "org": 1000,
            "assessment": false,
            "anchor": null,
            "anchorRelationship": null,
            "dataDefinitionId": null,
            "retentionEnabled": false,
            "isSystemConfig": false,
            "isLibraryObjectType": false
        },
        {
            "id": 522608,
            "name": "Cyber Control",
            "pluralName": "Cyber Controls",
            "description": "Cyber KICs object used as the primary assessment object in the Cyber KICs Assessment",
            "monogram": "CK",
            "nameKey": "app:objectType:name:2d46c0bf-198a-4a9f-9ac6-e28f63562da7",
            "descriptionKey": "app:objectType:description:5a689939-643f-479f-bcd7-c8879747e851",
            "pluralNameKey": "app:objectType:pluralName:22e46d60-b983-4db5-b4e0-76efdb4bd2ad",
            "monogramKey": "app:objectType:monogram:49854fc3-1bac-4fa8-8ad9-00204904be8f",
            "color": "#35add4",
            "objectLifeCycleId": 710789,
            "externalRefId": "052db388-85fc-4fd5-aca9-6ee493f68672",
            "created": "2024-06-24T16:02:18.020Z",
            "modified": "2026-09-10T20:42:26.363Z",
            "nextElement": 36,
            "org": 1000,
            "assessment": false,
            "anchor": null,
            "anchorRelationship": null,
            "dataDefinitionId": null,
            "retentionEnabled": false,
            "isSystemConfig": false,
            "isLibraryObjectType": true
        },
		...
	]
}
`

### ObjectLifeCycle/Permissions by RoleID

endpoint: "/data/rolePermissions/objectLifeCycles/role/{roleId}" (one param)

json structure from endpoint (using roleID: 765486 as an example)
`json
{
  "data": [
    {
      "objectLifeCycleId": 603174
    },
    {
      "objectLifeCycleId": 603272
    },
    {
      "objectLifeCycleId": 992693
    }
  ]
}
`


# Data Goal

The goal is to achieve a list of permissions based on the lifeCycleState for every object type for every role for each user group.

There seems to be an endpoint that lists the objectLifeCycles assocaited with a role (named ObjectLifeCycle/Permissions by RoleID in our doc). There seems to be an endpoint that seems to list all objectLifeCycles (with or without the state it is in) (ObjectLifeCycles in our doc). There seems to be an endpoint that lists all the different kinds of objectTypes (ObjectType in our doc). Somehow with these three calls, the website version is able to list the objectTypes that are associated with this role, and from there, we are able to click into each Object Type and see what permissions this role has for each object type at each state of the lifecycle that object type is at. 

Using this curent information, make a Typescript based web app that makes minimal api calls and processes all this data. Do your best to create data defintions and section out the code in smart way. If you need to do computations, try to optimize them if it ends up processing in O(n^3) time. Before then, don't bother, just flag it. Then for the frontend, have options to pick a User Group and then display information like name of User Group, the roles assocaited with that user group, and most importantly, which object Types (ObjectLifeCycles) have been added to each role, with the option of further being able to click on each object Type (ObjectLifeCycles) and seeing the permissions.

Follow best coding practices using coding. If you run into problem ping me. If there are any dependency issues, ping me before downloading them

Between every feature and code review, make a commit as {review/feature}:{description}:{time in MM/DD hour:min}
Along with these commits, make a file in a folder called commits/ at the root of the project and for every commit, make a new file following the commit name strcuture. In the file, description what you did and name the files that changed

### API Call:
`python
API_KEY = "dummy data"

headers = {
    "x-api-key": API_KEY,
    "Accept": "application/json",
    # "User-Agent": "Mozilla/5.0",
    # "Referer": "https://sandbox.resolver.com/"
} 

response = requests.get(group_url, headers=headers, timeout=30)
`

---

# Project state (handoff, written 09/16)

Everything above is the original spec. This section is what a new session needs
to know before touching anything. `update.md` (also in the repo) documents the
per-state permission endpoints added after the original spec.

**Next session's focus: the Excel output — the information it carries, and how
it looks.** Start from "Open questions for the Excel work" at the bottom.

## What exists

- **Web UI** — pick a user group → its roles → the object types each role
  reaches → click one for a per-state table (access, capabilities, triggers,
  form). `npm run dev` (API, :8787) + `npm run dev:client` (UI, :5173).
- **Per-group export** — "Export to Excel" button in the UI. Two sheets:
  `Summary`, `Permission Matrix`. Route: `GET /api/groups/:groupId/export`.
- **Master export** — `npm run export:all`. Three sheets: `Overview`,
  `User Groups`, `Permissions`. Flags: `--dry-run`, `--limit N`,
  `--groups 1,2,3`, `--out PATH`.
- **`process.md`** — a gitignored manual runbook for reproducing the master
  workbook by hand with curl. Keep it in step with any change to the flow.

Layout: `src/shared/types/domain.ts` is the only thing the client may see;
raw wire DTOs live in `src/server/types/resolver-api.ts` and must not leak past
`src/server/domain/normalize.ts`. Export code is `src/server/export/`, and the
whole column set is one array in `columns.ts` — adding a column is one
descriptor there and it lands in *both* workbooks.

## Endpoints in use beyond the original spec

| Endpoint | Gives |
|---|---|
| `/data/rolePermissions/role/{r}/objectType/{o}` | per-state access for one pair (UI drill-down) |
| `/data/rolePermissions` (no params) | **every** permission row in the org, one call — used by the master export |
| `/object/objectType/{o}/objectLifeCycle/state?deep=true` | states, trigger **names**, transitions |
| `/object/objectType/{o}/objectLifeCycle/stateRequired` | what each state requires to exit |
| `/object/form` | form id → name, whole org in one call |

## Semantics that are easy to get wrong

- `permission`: **0 = none, 1 = read, 2 = read and edit**. Inferred from
  observation, not documented. Anything else is `unknown` — never round it to
  "no access".
- `canManageRole` means *manage this object type while it is in this state*,
  not manage a role. It is labelled **Can Manage**.
- `formId: null` means the UI's **Default** option. What the default resolves to
  is not exposed anywhere — do not try to name it.
- **Lifecycles a role has no permission row in at all are dropped** from the
  export: an object type commonly owns lifecycles from unrelated processes.
  Only drop when the call *succeeded* — dropping on failure turns an outage
  into a confident "not relevant".
- **A missing row inside a lifecycle that has rows for other states means
  `none`**, with the `Can` cells FALSE. The API does omit the occasional state
  and Resolver's own UI shows it alongside the rest. `unreported` should never
  appear in output.
- **Blank is not FALSE.** Blank = the call failed, nobody knows. FALSE = the API
  said no. Writing FALSE for both makes `Can Edit = FALSE` filters unsafe.
- **Names are not unique** — group, object type and lifecycle names all collide
  in this tenant. Always carry and key on ids. Two separate analyses of mine
  were wrong from keying on names.
- Two endpoints are **not** `{data}`-enveloped: `stateRequired` and
  `objectLifeCycle/state`. `?deep=true` is a no-op on `stateRequired` and
  load-bearing on `state`.
- There is **no "ALL STATES" permission row.** Every row in the org has a
  concrete state id; that UI entry is a bulk-edit control. Do not go looking.

## Export shape

`Permissions` / `Permission Matrix` is 21 columns, left to right:

Group · Group Id · Role · Role Id · Object Type · Object Type Id · Lifecycle ·
Lifecycle Id · State · Access · Can Read · Can Edit · Can Create · Can Delete ·
Can Merge · Can Manage · Can Bulk Launch · # Triggers Granted ·
# Triggers Available · Triggers Granted · Form

`Access` is one word: `edit` / `read` / `none` / `unavailable` / `unknown`.
Booleans are written as real booleans, and the header is a single row, because
the sheet is meant to be a PivotTable source.

## Measured cost (live tenant, 09/15)

207 groups · 205 roles · 186 object types · 2,044 (role, object type) pairs →
**584 calls, ~22s, 196,860 rows, 12.6 MB**, peak memory 3,752 MB.

The bulk permissions endpoint replaced 2,044 per-pair calls with 1. exceljs
materialises the whole workbook before writing, so peak memory tracks row
count; it fits under Node's ~4 GB default now, but **if rows grow much past
this, switch to exceljs's streaming `WorkbookWriter`** rather than raising the
heap. Excel's own limit is 1,048,576 rows (currently at 19%).

## Working practices for this repo

- Run the **single affected** check suite while iterating
  (`check:data` / `check:render` / `check:live-path` / `check:dev-server` /
  `check:export`); run the full `npm run check` once before committing. The
  full run spawns servers and takes minutes.
- Use the **senior-code-reviewer** agent after each feature milestone, before
  the `review:` commit. It has found real bugs every round — including one
  where the export silently discarded reported permissions.
- `.env` holds `DATA_SOURCE=live|mock` and the key; it is gitignored and must
  stay that way. `exports/` and `process.md` are gitignored too.
- **This repo is public.** No live group names, role names or ids in committed
  files — fixtures and samples use invented people on `@example.com`.
- Environment notes: shell is zsh (no word-splitting on unquoted vars), there
  is no `lsof` (use `ss -lptnH "sport = :PORT"`), and Node 26 runs `.ts`
  directly so the check scripts need no build.

## Open questions for the Excel work

Nothing here is decided — these are the known seams:

1. **Appearance.** Only the header row is styled (bold, grey fill, frozen) plus
   autofilter and column widths. Untouched: conditional formatting on `Access`
   or the `Can` columns, number formats, zebra striping, per-sheet tab colours.
2. **`Summary` vs `Overview`.** The per-group workbook's `Summary` sheet rolls
   up one line per (role, object type) with state counts by level. The master
   workbook has no equivalent roll-up — only the flat `Permissions` sheet and
   the per-group `User Groups` stats. A cross-group roll-up may be the most
   useful missing thing.
3. **Rows a reader may still find surprising**: rows where `State` is blank
   (a role that reaches nothing, an unattributable grant, or an object type
   with no lifecycles). They carry an explanatory `note` internally, but the
   `note` column was removed from the agreed 21.
4. **`# Triggers Available`** counts every trigger on the state, which for a
   busy workflow is large (24 on one state) and may read oddly next to a
   granted count of 3.
5. Per-group and master exports share `MATRIX_COLUMNS`, so column changes hit
   both. If they should diverge, that is a deliberate decision to make.
