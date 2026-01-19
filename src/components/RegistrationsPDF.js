import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 10,
    fontFamily: 'Helvetica'
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    borderBottomStyle: 'solid',
    paddingBottom: 8
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 4
  },
  meta: {
    fontSize: 10,
    color: '#6b7280'
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 12,
    borderRadius: 4
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    borderBottomStyle: 'solid'
  },
  cellIdx: { width: '8%' },
  cellName: { width: '28%' },
  cellContact: { width: '34%' },
  cellTime: { width: '30%' },
  cellHeaderText: { fontWeight: 700, fontSize: 10 },
  cellText: { fontSize: 10 }
});

const RegistrationsPDF = ({ event, registrations }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>{event?.title || 'Event Registrations'}</Text>
        <Text style={styles.meta}>
          {event?.startDate ? `Date: ${event.startDate}` : ''}
          {event?.startHour ? `  Time: ${event.startHour}${event?.endHour ? ` - ${event.endHour}` : ''}` : ''}
        </Text>
        <Text style={styles.meta}>Total registrations: {registrations?.length || 0}</Text>
      </View>

      <View style={styles.tableHeader}>
        <View style={styles.cellIdx}><Text style={styles.cellHeaderText}>#</Text></View>
        <View style={styles.cellName}><Text style={styles.cellHeaderText}>Name</Text></View>
        <View style={styles.cellContact}><Text style={styles.cellHeaderText}>Contact</Text></View>
        <View style={styles.cellTime}><Text style={styles.cellHeaderText}>Registered At</Text></View>
      </View>

      {(registrations || []).map((r, idx) => (
        <View key={r.id || idx} style={styles.tableRow}>
          <View style={styles.cellIdx}><Text style={styles.cellText}>{idx + 1}</Text></View>
          <View style={styles.cellName}><Text style={styles.cellText}>{`${r.name || ''} ${r.lastName || ''}`.trim()}</Text></View>
          <View style={styles.cellContact}>
            <Text style={styles.cellText}>{r.email || '-'}</Text>
            <Text style={styles.cellText}>{r.phone || ''}</Text>
          </View>
          <View style={styles.cellTime}><Text style={styles.cellText}>{r.registeredAt}</Text></View>
        </View>
      ))}
    </Page>
  </Document>
);

export default RegistrationsPDF;
