import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    borderBottomStyle: "solid",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: "#475569",
    marginBottom: 2,
  },
  filterSection: {
    marginBottom: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#dbe5f0",
    borderStyle: "solid",
    borderRadius: 6,
    backgroundColor: "#f8fafc",
  },
  filterHeading: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
  },
  filterRow: {
    marginBottom: 3,
    color: "#334155",
  },
  projectSection: {
    marginBottom: 14,
  },
  projectHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    backgroundColor: "#eff6ff",
    borderLeftWidth: 4,
    borderLeftColor: "#2563eb",
    borderLeftStyle: "solid",
  },
  projectTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 2,
  },
  projectMeta: {
    fontSize: 8.5,
    color: "#475569",
  },
  statusSection: {
    marginBottom: 10,
  },
  statusHeader: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe5f0",
    borderStyle: "solid",
  },
  statusTitle: {
    fontSize: 9.5,
    fontWeight: 700,
    marginBottom: 2,
  },
  statusMeta: {
    fontSize: 8,
    color: "#64748b",
  },
  table: {
    display: "table",
    width: "auto",
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableHeaderRow: {
    backgroundColor: "#e2e8f0",
  },
  cell: {
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderLeftWidth: 0,
    borderTopWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 5,
  },
  headerCellText: {
    fontSize: 8.5,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  bodyCellText: {
    fontSize: 8.5,
    lineHeight: 1.35,
  },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 24,
    right: 24,
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
  },
});

const DEFAULT_COLUMN_WIDTH = 1;

const COLUMN_WIDTHS = {
  "Issue ID": 0.8,
  "Project Name": 1.2,
  Title: 1.8,
  "E2 Status Update Agile": 1.15,
  "E2 Lead Detailer": 1.1,
  "Data Stage": 0.8,
  "Technical Direction": 1.15,
  "Cycle Count": 0.65,
  "Percent Completed": 0.8,
  "Due Date": 0.85,
  Deadline: 1.1,
  "Latest Update": 1.8,
  "Last Update Time": 1,
};

const toCellText = (value) => {
  if (value === null || value === undefined) return "-";
  const stringValue = String(value).trim();
  return stringValue || "-";
};

const AgileDataTablePDF = ({ organizationName, exportedAt, filters, groups, visibleColumns }) => {
  const totalWeight = visibleColumns.reduce(
    (sum, column) => sum + (COLUMN_WIDTHS[column] || DEFAULT_COLUMN_WIDTH),
    0
  );
  const totalRows = groups.reduce(
    (groupCount, group) => groupCount + group.statusGroups.reduce((statusCount, statusGroup) => statusCount + statusGroup.rows.length, 0),
    0
  );

  const renderTable = (rows) => (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {visibleColumns.map((column) => {
          const widthPercent = `${(((COLUMN_WIDTHS[column] || DEFAULT_COLUMN_WIDTH) / totalWeight) * 100).toFixed(2)}%`;
          return (
            <View key={column} style={[styles.cell, { width: widthPercent }]}>
              <Text style={styles.headerCellText}>{column}</Text>
            </View>
          );
        })}
      </View>

      {rows.map((row, rowIndex) => (
        <View key={`${row.issueKey || rowIndex}`} style={styles.tableRow} wrap={false}>
          {visibleColumns.map((column) => {
            const widthPercent = `${(((COLUMN_WIDTHS[column] || DEFAULT_COLUMN_WIDTH) / totalWeight) * 100).toFixed(2)}%`;
            return (
              <View key={`${row.issueKey || rowIndex}-${column}`} style={[styles.cell, { width: widthPercent }]}>
                <Text style={styles.bodyCellText}>{toCellText(row[column])}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <Text style={styles.title}>Agile Data Table Export</Text>
          <Text style={styles.meta}>Organization: {toCellText(organizationName)}</Text>
          <Text style={styles.meta}>Generated: {toCellText(exportedAt)}</Text>
          <Text style={styles.meta}>Cards exported: {totalRows}</Text>
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterHeading}>Applied Filters</Text>
          {filters.map((filter) => (
            <Text key={filter.label} style={styles.filterRow}>
              {filter.label}: {toCellText(filter.value)}
            </Text>
          ))}
        </View>

        {groups.map((group, groupIndex) => (
          <View key={group.projectName} style={styles.projectSection} break={groupIndex > 0}>
            <View style={styles.projectHeader} minPresenceAhead={110}>
              <Text style={styles.projectTitle}>{toCellText(group.projectName)}</Text>
              <Text style={styles.projectMeta}>{group.cardCount} card(s)</Text>
            </View>

            {group.statusGroups.map((statusGroup) => (
              <View key={`${group.projectName}-${statusGroup.status}`} style={styles.statusSection} wrap={false}>
                <View style={styles.statusHeader} minPresenceAhead={90}>
                  <Text style={styles.statusTitle}>{toCellText(statusGroup.status)}</Text>
                  <Text style={styles.statusMeta}>{statusGroup.cardCount} card(s)</Text>
                </View>
                {renderTable(statusGroup.rows)}
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Agile Data Table Module
        </Text>
      </Page>
    </Document>
  );
};

export default AgileDataTablePDF;