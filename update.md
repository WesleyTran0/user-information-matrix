> **Redaction note.** Org id replaced with a placeholder; endpoint paths,
> payload shapes and relationships are untouched.

The following are all the calls that are made when clicking into an Object Type assigned to a role to see what permissions this role has when it comes to this Object Type at every state of its ObjectLifeCycle.

### Retrieves all states and their required elements of this objectType

endpoint: 
/object/objectType/{objectTypeId}/objectLifeCycle/stateRequired (1 param)

json structure from endpoint (exmaple using objectTypeId=442972)
`json
{
    "2670249": [
        {
            "id": 796559,
            "objectLifeCycleStateId": 2670249,
            "fieldId": 3146729,
            "org": 1000,
            "objectLifeCycleId": 603174,
            "relationshipTypeId": null,
            "propertyId": null,
            "type": 1,
            "roleId": null
        },
        {
            "id": 500074,
            "objectLifeCycleStateId": 2670249,
            "fieldId": null,
            "org": 1000,
            "objectLifeCycleId": 603174,
            "relationshipTypeId": null,
            "propertyId": null,
            "type": 4,
            "roleId": 449681
        },
		...
	]
}
`

### All states of the current objectType

endpoint: /object/objectType/{objectTypeId}/objectLifeCycle/state?deep=true (1 param, 1 opt param but was true when called)

json structure from endpoint (example using objectTypeId=442972 and deep=true)
`json
{
  "603174": {
    "states": [
      {
        "id": 2670249,
        "objectLifeCycleId": 603174,
        "name": "Creation",
        "stateCategoryId": null,
        "nameKey": "app:objectLifeCycleState:name:2a5af74f-9a0e-459f-98eb-c6a0da629ade",
        "color": "#35ADD4",
        "ordinal": -1,
        "created": "2017-12-15T06:28:06.519Z",
        "modified": "2026-09-02T15:45:28.216Z",
        "org": 1000,
        "creation": true,
        "isSystemConfig": false,
        "externalRefId": "45f12a15-ce28-460a-a04a-308d34eab2f9",
        "triggers": [
          3193113,
          3193121,
          3193392,
          3193426,
          3193492,
          3193756,
          3193763,
          3193778,
          3825175,
          5501769,
          6105539
        ]
      },
      {
        "id": 2671078,
        "objectLifeCycleId": 603174,
        "name": "Draft",
        "stateCategoryId": 1,
        "nameKey": "app:objectLifeCycleState:name:d727f104-f074-4a65-99ae-0b9b1d707f14",
        "color": "#dadee0",
        "ordinal": 0,
        "created": "2017-12-15T06:28:06.519Z",
        "modified": "2026-08-10T15:41:16.873Z",
        "org": 1000,
        "creation": false,
        "isSystemConfig": false,
        "externalRefId": "cef34ef0-956b-4934-9291-8219ffcf3768",
        "triggers": [
          3193590,
          3264968,
          6045695,
          6045698,
          6045708
        ]
      },
	....
	}
}
`

### Load role permissions for objectTypeId and roleId

endpoint: /data/rolePermissions/role/{roleId}/objectType/{objectTypeId} (2 params)

json structure from endpoint (using roleId=765486 and objectTypeId=442972)
`json
{
    "data": [
        {
            "id": 23885514,
            "permission": 1,
            "canBulkLaunch": false,
            "canCreate": false,
            "canDelete": false,
            "canMerge": false,
            "canManageRole": false,
            "roleId": 765486,
            "objectTypeId": 442972,
            "objectLifeCycleId": 603174,
            "objectLifeCycleStateId": 2670249,
            "formId": null,
            "org": 1000,
            "externalRefId": "718ce827-03aa-491c-bbd1-98f2fbb7ddfd",
            "assigned": false,
            "created": "2026-01-14T14:55:31.116Z",
            "modified": "2026-01-14T14:55:31.116Z",
            "createdBy": 284320,
            "modifiedBy": null
        },
        {
            "id": 23885737,
            "permission": 1,
            "canBulkLaunch": false,
            "canCreate": false,
            "canDelete": false,
            "canMerge": false,
            "canManageRole": false,
            "roleId": 765486,
            "objectTypeId": 442972,
            "objectLifeCycleId": 603174,
            "objectLifeCycleStateId": 2670564,
            "formId": null,
            "org": 1000,
            "externalRefId": "f00bfe25-1c81-488b-8144-73e8be39cca0",
            "assigned": false,
            "created": "2026-01-14T14:55:31.116Z",
            "modified": "2026-01-14T14:55:31.116Z",
            "createdBy": 284320,
            "modifiedBy": null
        },
	...
	]
}
`

This one seems to have the current number of *states* that is showing on the web ui, however, I don't think it shows me the permissions that this role can access on these states. If it does that is great!

# Goal

Using these calls, I need to ALSO see that for each state, this role can trigger xyz and has permission to (read/edit/deleted/etc.) to this objectType when it is in xyz state.
