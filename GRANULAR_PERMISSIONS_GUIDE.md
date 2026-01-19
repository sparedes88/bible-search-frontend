# Enhanced Permissions System Documentation

## Overview

The enhanced permissions system extends the existing module-based permissions to support granular access control for specific resources like forms, inventory items, categories, and galleries. This allows administrators to grant users access to only specific items within a module rather than the entire module.

## Key Features

- **Module-level permissions**: Traditional permissions for entire modules (forms, inventory, etc.)
- **Resource-specific permissions**: Granular control over individual forms, inventory items, categories, galleries
- **Multiple access patterns**: Whitelist (only selected), Blacklist (all except selected), Specific permissions
- **Backward compatibility**: Existing permission system continues to work unchanged

## Permission Levels

### 1. Module-Level Permissions (Existing)
Users can have permissions for entire modules:
- `forms` - Access to all forms
- `inventory` - Access to all inventory items  
- `coursecategories` - Access to all categories
- `gallery` - Access to all galleries

### 2. Resource-Specific Permissions (New)
Users can have specific permissions for individual resources within modules:

#### Access Types:

**Full Module Access (Default)**
- User has access based on module-level permissions only
- No resource-specific restrictions

**Whitelist (Only Selected)**
- User can only access specifically allowed resources
- All other resources in the module are denied

**Blacklist (All Except Selected)**  
- User can access all resources except specifically denied ones
- Good for restricting access to sensitive items

**Specific Permissions**
- Granular control with individual CRUD permissions per resource
- Can set create, read, update, delete permissions per item

## Implementation Guide

### 1. Using Enhanced Permissions in Components

```javascript
import { 
  hasFormPermission, 
  hasInventoryPermission, 
  hasCategoryPermission,
  hasGalleryPermission,
  getUserAccessibleForms,
  getUserAccessibleInventory
} from '../utils/enhancedPermissions';

// Check specific form permission
const canEditForm = await hasFormPermission(user, churchId, formId, 'update');

// Get all forms user can access
const accessibleForms = await getUserAccessibleForms(user, churchId);

// Check specific inventory permission
const canDeleteItem = await hasInventoryPermission(user, churchId, itemId, 'delete');
```

### 2. Setting Up Resource Permissions

#### For Administrators:

1. Go to Role Manager
2. Select a role or create a new one
3. Click "🎯 Resource Permissions" button
4. For each resource type (Forms, Inventory, Categories, Galleries):
   - Choose access type: Full Module, Whitelist, Blacklist, or Specific
   - Configure access as needed
5. Save permissions

#### Permission Structure in Firestore:

```javascript
// Role document with resource permissions
{
  name: "Form Manager",
  description: "Can manage specific forms only",
  permissions: {
    forms: {
      create: true,
      read: true,
      update: true,
      delete: false,
      manage: true,
      export: true
    }
  },
  resourcePermissions: {
    form: {
      accessType: "whitelist",
      allowedResources: ["form-id-1", "form-id-2"]
    },
    inventory: {
      accessType: "blacklist", 
      deniedResources: ["sensitive-item-id"]
    },
    category: {
      accessType: "specific",
      specific: {
        "category-id-1": {
          create: false,
          read: true,
          update: true,
          delete: false
        }
      }
    }
  }
}
```

### 3. Updating Existing Components

To add enhanced permissions to existing components:

```javascript
// Before: Simple module check
const canEdit = await hasPermission(user, churchId, 'forms', 'update');

// After: Resource-specific check
const canEditSpecificForm = await hasFormPermission(user, churchId, formId, 'update');

// Before: Load all resources
const formsRef = collection(db, `churches/${churchId}/forms`);
const snapshot = await getDocs(formsRef);
const forms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

// After: Load only accessible resources
const accessibleForms = await getUserAccessibleForms(user, churchId);
```

## Available Functions

### Permission Checking Functions

```javascript
// General permission with optional resource specificity
hasPermission(user, churchId, module, action, resourceId?, resourceType?)

// Resource-specific shortcuts
hasFormPermission(user, churchId, formId, action)
hasInventoryPermission(user, churchId, inventoryId, action) 
hasCategoryPermission(user, churchId, categoryId, action)
hasGalleryPermission(user, churchId, galleryId, action)
```

### Resource Fetching Functions

```javascript
// Get all accessible resources
getUserAccessibleForms(user, churchId)
getUserAccessibleInventory(user, churchId)

// Legacy compatibility
canAccessModule(user, churchId, module)
canManageModule(user, churchId, module)
getUserAccessibleModules(user, churchId)
```

### Action Types

- `create` - Can create new items
- `read` - Can view items  
- `update` - Can edit items
- `delete` - Can remove items
- `manage` - Administrative control
- `export` - Can export data

## Use Cases

### Scenario 1: Department-Specific Forms
A church wants youth leaders to only access youth-related forms:

1. Create "Youth Leader" role
2. Grant module permission to `forms`
3. Set resource permission to "Whitelist" 
4. Add only youth form IDs to allowed list

### Scenario 2: Inventory Restrictions
Prevent volunteers from accessing expensive equipment:

1. Create "Volunteer" role
2. Grant module permission to `inventory`
3. Set resource permission to "Blacklist"
4. Add expensive equipment IDs to denied list

### Scenario 3: Category-Specific Access
Allow teachers to only edit their own course categories:

1. Create "Teacher" role
2. Grant module permission to `coursecategories`
3. Set resource permission to "Specific"
4. Set read/update permissions for their categories only

## Best Practices

1. **Start with Module Permissions**: Set up basic module access first
2. **Use Whitelists for High Security**: When you need strict control
3. **Use Blacklists for Convenience**: When most access is allowed with few exceptions
4. **Use Specific Permissions for Granular Control**: When different actions need different permissions
5. **Test Thoroughly**: Always test permission changes with different user roles
6. **Document Access Requirements**: Keep track of who needs access to what

## Migration Guide

Existing components will continue to work without changes. To add enhanced permissions:

1. Import enhanced permission functions
2. Replace general permission checks with resource-specific ones where needed
3. Update resource loading to use filtered functions
4. Add resource-specific permission checks to action handlers

The system is backward compatible - if no resource permissions are configured, it falls back to module-level permissions.

## Troubleshooting

### Common Issues:

1. **User sees no resources**: Check both module and resource permissions
2. **Permission denied errors**: Verify resource-specific access configuration
3. **Performance issues**: Consider caching accessible resource lists
4. **Legacy compatibility**: Ensure existing permission checks still work

### Debug Tips:

```javascript
// Check what permissions a user has
const moduleAccess = await hasPermission(user, churchId, 'forms', 'read');
const specificAccess = await hasFormPermission(user, churchId, formId, 'read');
console.log('Module access:', moduleAccess, 'Specific access:', specificAccess);

// Check accessible resources
const accessibleForms = await getUserAccessibleForms(user, churchId);
console.log('User can access', accessibleForms.length, 'forms');
```

## Integration Examples

See `PermissionExampleComponent.js` for complete implementation examples and `Forms.js` for real-world usage patterns.
