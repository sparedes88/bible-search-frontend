# Excel to Firestore BIM Upload Guide

## Overview
This guide explains how to upload the **UCSF BCH NHB.xlsx** file from OneDrive to your Firestore database as a BIM project.

## Files Created

### 1. `scripts/interactive-upload.js` (Recommended)
**Interactive script that guides you through the upload process.**

#### Features:
- Lists all available organizations in Firestore
- Allows you to select the target organization
- Validates the Excel file
- Shows a sample of the data before uploading
- Uploads to Firestore with proper formatting

#### Usage:
```bash
cd "c:\Users\BenSolorzano\Desktop\Projects\Project 1\bible-search-frontend"
node scripts/interactive-upload.js
```

#### What happens:
1. Script lists all churches in your Firestore database
2. You select the organization number
3. You provide the path to UCSF BCH NHB.xlsx
4. Script optionally prompts for a custom project name
5. File is parsed and uploaded to: `churches/{organizationId}/bimProjects/{projectId}`

### 2. `scripts/upload-excel-to-bim.js` (Command-line)
**Direct upload script if you already know the Church ID.**

#### Usage:
```bash
node scripts/upload-excel-to-bim.js "C:\full\path\to\UCSF BCH NHB.xlsx" "church-id-123" "UCSF BCH NHB"
```

#### Parameters:
- **excelPath** (required): Full path to the Excel file
- **churchId** (required): Firebase church/organization ID
- **projectName** (optional): Custom project name

## File Location
The UCSF BCH NHB.xlsx file is located at:
```
C:\Users\BenSolorzano\OneDrive - E2 Tech Support\E2 Tech Team - VDC Project - Equipo Operativo\Exports\UCSF BCH NHB.xlsx
```

**File Size**: 26,102 bytes  
**Last Modified**: 3/30/2026 4:02 PM

## Prerequisites

Ensure you have:
1. ✅ Node.js installed
2. ✅ Firebase Admin SDK initialized (service account JSON)
3. ✅ XLSX library (npm package - already in project)
4. ✅ Firestore access with write permissions

## Firestore Structure

After upload, your data will be stored at:
```
firestore
└── churches/{organizationId}/bimProjects/{projectId}/
    ├── name: "UCSF BCH NHB"
    ├── fields: [array of column names]
    ├── rows: [array of row data]
    ├── createdAt: timestamp
    ├── updatedAt: timestamp
    └── internalCardMeta: {}
```

## How Data is Structured

**Fields Array**: Names of all Excel columns
```
["Column 1", "Column 2", "Column 3", ...]
```

**Rows Array**: Excel data rows
```
[
  {
    rowNumber: 1,
    rowData: {
      "Column 1": "Value 1",
      "Column 2": "Value 2",
      ...
    }
  },
  ...
]
```

## Integration with ProjectIssueDashboard

Once uploaded, the data will:
1. Appear in the **Project Issue Dashboard** for that organization
2. Be queryable with filters (Project Name, Status, E2 Lead Detailer, etc.)
3. Support editable columns (E2 Status Update, Snapshots, etc.)
4. Be linked to issue tracking workflow

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "File not found" | Verify the Excel file path is correct |
| "No organizations found" | Check Firebase Firestore connection and permissions |
| "Invalid selection" | Ensure you enter a valid organization number |
| Upload hangs | Check internet connection and Firestore quota limits |

## Recommended Workflow

1. **First run** (interactive):
   ```bash
   node scripts/interactive-upload.js
   ```
   This lets you see available organizations and select the correct one.

2. **Verify in Firestore Console**:
   - Navigate to `firebase.google.com` → Select your project
   - Go to Firestore Database
   - Check `churches/{organizationId}/bimProjects` for your new project

3. **View in ProjectIssueDashboard**:
   - Navigate to your org dashboard
   - You should see the data in the Project Issue List
   - Apply filters and verify data integrity

## Next Steps

After uploading:
- Test the filters in ProjectIssueDashboard
- Verify all columns are correctly mapped
- Configure E2 Lead Detailer assignments if needed
- Set up any required status updates

---

**Created**: 2024
**Purpose**: One-time migration of UCSF BCH NHB project data
