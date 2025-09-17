import React from 'react';
import { Document, Page, Text, View, StyleSheet, PDFViewer, Font } from '@react-pdf/renderer';

// Create styles
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
    marginBottom: 30,
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
    fontSize: 18,
    marginBottom: 5,
    color: '#4a5568',
  },
  eventInfo: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f7fafc',
    borderRadius: 4,
  },
  eventTime: {
    fontSize: 16,
    color: '#2d3748',
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 20,
    marginBottom: 15,
    color: '#2c5282',
    borderBottom: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
  },
  task: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    borderLeft: 4,
    borderLeftColor: '#4299e1',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  taskTime: {
    fontSize: 14,
    color: '#2c5282',
    fontWeight: 'bold',
  },
  taskDuration: {
    fontSize: 12,
    color: '#718096',
  },
  taskDescription: {
    fontSize: 14,
    marginVertical: 8,
    color: '#2d3748',
  },
  taskResponsible: {
    fontSize: 12,
    color: '#4a5568',
    marginBottom: 5,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  taskTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    fontSize: 10,
    backgroundColor: '#edf2f7',
    padding: '3 6',
    marginRight: 4,
    marginBottom: 4,
    borderRadius: 4,
    color: '#4a5568',
  },
  note: {
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 4,
    borderLeft: 3,
    borderLeftColor: '#cbd5e0',
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  noteStatus: {
    fontSize: 10,
    padding: '2 6',
    borderRadius: 4,
  },
  statusPending: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
  statusInProgress: {
    backgroundColor: '#DBEAFE',
    color: '#1E40AF',
  },
  statusCompleted: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
  },
  noteAssignee: {
    fontSize: 10,
    color: '#dc2626',
  },
  noteContent: {
    fontSize: 12,
    marginBottom: 6,
    color: '#4a5568',
    lineHeight: 1.4,
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
  timeLine: {
    position: 'absolute',
    left: 20,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#e2e8f0',
  },
  divider: {
    borderBottom: 1,
    borderBottomColor: '#e2e8f0',
    marginVertical: 15,
  },
  taskNotes: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: 1,
    borderTopColor: '#e2e8f0',
  },
  taskNotesTitle: {
    fontSize: 12,
    color: '#4a5568',
    marginBottom: 8,
    fontWeight: 'bold',
  },
  taskNote: {
    marginBottom: 10,
    paddingLeft: 8,
    borderLeft: 2,
    borderLeftColor: '#cbd5e0',
  },
  noteEmpty: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#a0aec0',
  },
});

const EventCoordinationPDF = ({ event, tasks, generalNotes }) => (
  <PDFViewer style={{ width: '100%', height: '90vh' }}>
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Event Coordination Plan</Text>
          <View style={styles.eventInfo}>
            <Text style={styles.subtitle}>{event?.title}</Text>
            <Text style={styles.eventTime}>Start Time: {event?.startHour}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule ({tasks.length} Tasks)</Text>
          {tasks.map((task, index) => (
            <View key={task.id} style={styles.task}>
              <View style={styles.taskHeader}>
                <View>
                  <Text style={styles.taskTime}>{task.startTime}</Text>
                  <Text style={styles.taskDuration}>Duration: {task.duration} minutes</Text>
                </View>
                <Text style={styles.taskResponsible}>Assigned to: {task.responsible}</Text>
              </View>
              <View style={styles.divider} />
              <Text style={styles.taskDescription}>{task.description}</Text>
              {task.tags?.length > 0 && (
                <View style={styles.taskTags}>
                  {task.tags.map((tag, i) => (
                    <Text key={i} style={styles.tag}>{tag}</Text>
                  ))}
                </View>
              )}
              
              {/* Task Notes Section */}
              <View style={styles.taskNotes}>
                <Text style={styles.taskNotesTitle}>Notes & Comments ({task.notes?.length || 0})</Text>
                {!task.notes?.length ? (
                  <Text style={styles.noteEmpty}>No notes for this task</Text>
                ) : (
                  task.notes.map((note) => (
                    <View key={note.id} style={styles.taskNote}>
                      <View style={styles.noteHeader}>
                        <Text 
                          style={[
                            styles.noteStatus,
                            note.status === 'pending' ? styles.statusPending :
                            note.status === 'in-progress' ? styles.statusInProgress :
                            styles.statusCompleted
                          ]}
                        >
                          {note.status.toUpperCase()}
                        </Text>
                        {note.assignedTo && (
                          <Text style={styles.noteAssignee}>@{note.assignedTo}</Text>
                        )}
                      </View>
                      <Text style={styles.noteContent}>{note.content}</Text>
                      {note.tags?.length > 0 && (
                        <View style={styles.taskTags}>
                          {note.tags.map((tag, i) => (
                            <Text key={i} style={styles.tag}>{tag}</Text>
                          ))}
                        </View>
                      )}
                      <Text style={{ fontSize: 10, color: '#718096', marginTop: 4 }}>
                        {new Date(note.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          ))}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General Notes ({generalNotes.length} Notes)</Text>
          {generalNotes.map((note) => (
            <View key={note.id} style={styles.note}>
              <View style={styles.noteHeader}>
                <Text 
                  style={[
                    styles.noteStatus,
                    note.status === 'pending' ? styles.statusPending :
                    note.status === 'in-progress' ? styles.statusInProgress :
                    styles.statusCompleted
                  ]}
                >
                  {note.status.toUpperCase()}
                </Text>
                {note.assignedTo && (
                  <Text style={styles.noteAssignee}>@{note.assignedTo}</Text>
                )}
              </View>
              <Text style={styles.noteContent}>{note.content}</Text>
              {note.tags?.length > 0 && (
                <View style={styles.taskTags}>
                  {note.tags.map((tag, i) => (
                    <Text key={i} style={styles.tag}>{tag}</Text>
                  ))}
                </View>
              )}
              <Text style={{ fontSize: 10, color: '#718096', marginTop: 4 }}>
                {new Date(note.createdAt).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
          `${pageNumber} / ${totalPages}`
        )} fixed />
      </Page>
    </Document>
  </PDFViewer>
);

export default EventCoordinationPDF;