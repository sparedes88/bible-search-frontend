import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, PDFDownloadLink } from '@react-pdf/renderer';

// Create styles for the PDF
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 12,
    color: '#333',
    backgroundColor: '#fff',
  },
  header: {
    marginBottom: 20,
    borderBottom: 2,
    borderBottomColor: '#4299e1',
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    marginBottom: 10,
    color: '#2c5282',
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 5,
    color: '#4a5568',
  },
  dateInfo: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 5,
  },
  filterSection: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#f7fafc',
    borderRadius: 4,
  },
  filterTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#4a5568',
  },
  filterItem: {
    fontSize: 10,
    marginBottom: 3,
    color: '#4a5568',
  },
  table: {
    display: 'table',
    width: 'auto',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    margin: 'auto',
    flexDirection: 'row',
  },
  tableHeader: {
    backgroundColor: '#f7fafc',
    fontWeight: 'bold',
  },
  tableHeaderCell: {
    margin: 5,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#4a5568',
  },
  tableCell: {
    margin: 5,
    fontSize: 10,
    color: '#4a5568',
  },
  tableCellName: {
    width: '15%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCellLastName: {
    width: '15%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCellPhone: {
    width: '15%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCellStatus: {
    width: '15%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCellTags: {
    width: '25%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tableCellDate: {
    width: '15%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  tag: {
    fontSize: 8,
    backgroundColor: '#edf2f7',
    marginRight: 3,
    marginBottom: 2,
    padding: '2 4',
    borderRadius: 2,
    color: '#4a5568',
    display: 'inline',
  },
  pageNumber: {
    position: 'absolute',
    fontSize: 10,
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#a0aec0',
  },
  statusBadge: {
    fontSize: 8,
    padding: '2 4',
    borderRadius: 2,
    textAlign: 'center',
  },
  memberBadge: {
    backgroundColor: '#ebf8ff',
    color: '#2b6cb0',
  },
  migratedBadge: {
    backgroundColor: '#e6fffa',
    color: '#2c7a7b',
  },
  visitorBadge: {
    backgroundColor: '#edf2f7',
    color: '#4a5568',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: '#a0aec0',
    fontSize: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    borderTopStyle: 'solid',
    paddingTop: 10,
  },
});

// PDF Document component
const AdminConnectPDF = ({ data, activeTab, filters }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Church Admin - {activeTab === 'visitors' ? 'Visitors' : 'Members'} List</Text>
        <Text style={styles.dateInfo}>Generated on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</Text>
      </View>

      {/* Filter information */}
      <View style={styles.filterSection}>
        <Text style={styles.filterTitle}>Applied Filters</Text>
        {filters.searchTerm && <Text style={styles.filterItem}>Search: {filters.searchTerm}</Text>}
        {filters.tagFilters.length > 0 && <Text style={styles.filterItem}>Tags: {filters.tagFilters.join(', ')}</Text>}
        <Text style={styles.filterItem}>
          Date Filter: {
            filters.customDateFilter && filters.selectedDate 
              ? `Custom Date: ${filters.selectedDate}`
              : filters.dateFilterOptions.find(option => option.value === filters.dateFilter)?.label || 'All Dates'
          }
        </Text>
        <Text style={styles.filterItem}>
          Sort: {
            filters.sortConfig.field === 'createdAt' 
              ? `Date (${filters.sortConfig.direction === 'asc' ? 'Oldest First' : 'Newest First'})`
              : filters.sortConfig.field === 'fullName'
                ? `Name (${filters.sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})`
                : `Phone (${filters.sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A'})`
          }
        </Text>
        <Text style={styles.filterItem}>Total Items: {data.length}</Text>
      </View>

      {/* Table */}
      <View style={styles.table}>
        {/* Table Header */}
        <View style={[styles.tableRow, styles.tableHeader]}>
          <View style={styles.tableCellName}>
            <Text style={styles.tableHeaderCell}>Name</Text>
          </View>
          <View style={styles.tableCellLastName}>
            <Text style={styles.tableHeaderCell}>Last Name</Text>
          </View>
          <View style={styles.tableCellPhone}>
            <Text style={styles.tableHeaderCell}>Phone</Text>
          </View>
          <View style={styles.tableCellStatus}>
            <Text style={styles.tableHeaderCell}>Status</Text>
          </View>
          <View style={styles.tableCellTags}>
            <Text style={styles.tableHeaderCell}>Tags</Text>
          </View>
          <View style={styles.tableCellDate}>
            <Text style={styles.tableHeaderCell}>Date Added</Text>
          </View>
        </View>

        {/* Table Rows */}
        {data.map((item) => (
          <View key={item.id} style={styles.tableRow}>
            <View style={styles.tableCellName}>
              <Text style={styles.tableCell}>{item.name}</Text>
            </View>
            <View style={styles.tableCellLastName}>
              <Text style={styles.tableCell}>{item.lastName}</Text>
            </View>
            <View style={styles.tableCellPhone}>
              <Text style={styles.tableCell}>{item.phone}</Text>
            </View>
            <View style={styles.tableCellStatus}>
              {item.isMember && item.isMigrated ? (
                <Text style={[styles.statusBadge, styles.migratedBadge]}>Migrated Member</Text>
              ) : item.isMember ? (
                <Text style={[styles.statusBadge, styles.memberBadge]}>Direct Member</Text>
              ) : (
                <Text style={[styles.statusBadge, styles.visitorBadge]}>Visitor</Text>
              )}
            </View>
            <View style={styles.tableCellTags}>
              <Text style={styles.tableCell}>{item.tags?.join(', ') || ''}</Text>
            </View>
            <View style={styles.tableCellDate}>
              <Text style={styles.tableCell}>{item.createdAt}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        Church Administration System - Confidential Information
      </Text>

      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => (
          `${pageNumber} / ${totalPages}`
        )}
        fixed
      />
    </Page>
  </Document>
);

// Export component with PDFDownloadLink wrapper
const AdminConnectPDFLink = ({ data, activeTab, filters, filename }) => (
  <PDFDownloadLink
    document={
      <AdminConnectPDF 
        data={data} 
        activeTab={activeTab} 
        filters={filters} 
      />
    }
    fileName={filename || `${activeTab}-list-${new Date().toISOString().split('T')[0]}.pdf`}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      backgroundColor: '#4b5563',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      padding: '8px 14px',
      fontSize: '14px',
      cursor: 'pointer',
      textDecoration: 'none',
    }}
  >
    {({ blob, url, loading, error }) =>
      loading ? 'Generating PDF...' : 'Download PDF'
    }
  </PDFDownloadLink>
);

export default AdminConnectPDFLink;