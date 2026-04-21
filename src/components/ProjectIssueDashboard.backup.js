// BACKUP of previous ProjectIssueDashboard.js
// If you need to restore, copy this file over ProjectIssueDashboard.js

// --- Original content below ---

// Default options for E2 Status Update dropdown
const DEFAULT_E2_STATUS_UPDATE_OPTIONS = [];
// Default options for E2 Detailer dropdown
const DEFAULT_E2_DETAILER_OPTIONS = [];
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
// Data Stage options for dropdown
const DATA_STAGE_OPTIONS = ["--", "Design", "Review", "Approved", "Construction", "Completed"];

function ProjectIssueDashboard(props) {
  // Use churchId from props, or fallback to 'default' if not provided
  const churchId = props.churchId || "default";
  // ...existing code...

  // Ensure all church/project context references use churchId, not id

  // Add state for popup
  const [showTechDetailsPopup, setShowTechDetailsPopup] = useState(false);
  const [selectedIssueForTechDetails, setSelectedIssueForTechDetails] = useState(null);
  const [dataStage, setDataStage] = useState(DATA_STAGE_OPTIONS[0]);

  // Handler to open popup
  const handleOpenTechDetailsPopup = (issue) => {
    setSelectedIssueForTechDetails(issue);
    setShowTechDetailsPopup(true);
    setDataStage(DATA_STAGE_OPTIONS[0]);
  };
  const handleCloseTechDetailsPopup = () => {
    setShowTechDetailsPopup(false);
    setSelectedIssueForTechDetails(null);
  };
  const handleSubmitTechDetails = () => {
    // TODO: Save technical details (dataStage) for selectedIssueForTechDetails
    setShowTechDetailsPopup(false);
    setSelectedIssueForTechDetails(null);
    toast.success("Technical details submitted!");
  };

  // ...rest of the component code...

const E2_DETAILER_FIELD = "E2 Lead Detailer";
const E2_DETAILER_SUPPORT_TEAM_FIELD = "E2 Detailer Support Team";
const ISSUE_ID_FIELD_ALIASES = ["issue id", "id", "task id", "card id", "row id"];
const TITLE_FIELD_ALIASES = ["title", "task title", "name"];
const PROJECT_NAME_FIELD_ALIASES = ["project name", "projectname"];
const OWNER_FIELD_ALIASES = ["assignee", "assigned to", "owner", "responsible"];
const E2_STATUS_UPDATE_FIELD_ALIASES = ["e2 status update", "e2statusupdate"];
const TAG_FIELD_ALIASES = ["tags", "tag", "labels", "label"];
const E2_TAGS_FIELD_ALIASES = ["e2 tags", "e2 tag", "e2tags", "e2tag"];

const E2_STATUS_UPDATE_FIELD = "E2 Status Update";

const E2_STATUS_DATE_FIELD = "E2 Status Date";
const E2_STATUS_DATE_FIELD_ALIASES = [
  "e2statusdate",
  "status update date",
  "statusupdatedate",
  "status date",
  "statusdate",
];
