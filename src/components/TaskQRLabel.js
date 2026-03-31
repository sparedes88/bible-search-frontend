import React from 'react';
import { Page, Text, Document, StyleSheet, Image, View } from '@react-pdf/renderer';
import QRCodeGenerator from 'qrcode';

const getPriorityColor = (priority) => {
  switch (priority) {
    case 'high':
      return '#DC2626'; // Red
    case 'medium':
      return '#F59E0B'; // Orange
    case 'low':
      return '#2563EB'; // Blue
    default:
      return '#6B7280'; // Gray
  }
};

const styles = StyleSheet.create({
  page: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 10,
  },
  qrCodeContainer: {
    width: '40%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  textContainer: {
    width: '60%',
    paddingLeft: 10,
    justifyContent: 'center',
  },
  logo: {
    position: 'absolute',
    width: 40,
    height: 40,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 1,
  },
  text: {
    fontSize: 12,
    marginBottom: 5,
    color: '#374151',
  },
  priority: {
    fontSize: 10,
    padding: '2 6',
    borderRadius: 4,
    marginBottom: 5,
    alignSelf: 'flex-start',
  }
});

const TaskQRLabel = ({ task, qrUrl, church }) => {
  const [qrDataURL, setQrDataURL] = React.useState('');

  const getPriorityColor = (priority) => {
    switch (priority.toLowerCase()) {
      case 'high':
        return '#DC2626'; // Red
      case 'medium':
        return '#F59E0B'; // Orange
      case 'low':
        return '#2563EB'; // Blue
      default:
        return '#6B7280'; // Gray
    }
  };

  const isValidImageSrc = (src) => {
    if (!src || typeof src !== 'string') return false;
    const trimmed = src.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('data:image/')) return true;
    return /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(trimmed);
  };

  React.useEffect(() => {
    const generateQR = async () => {
      try {
        if (!qrUrl) {
          setQrDataURL('');
          return;
        }
        const dataUrl = await QRCodeGenerator.toDataURL(qrUrl, { margin: 0, width: 200 });
        setQrDataURL(dataUrl || '');
      } catch (err) {
        console.error('Error generating QR code:', err);
        setQrDataURL('');
      }
    };
    generateQR();
  }, [qrUrl]);

  return (
    <Document>
      <Page size={{ width: 432, height: 144 }} style={styles.page}>
        <View style={styles.qrCodeContainer}>
          {qrDataURL && <Image src={qrDataURL} />}
          {isValidImageSrc(church?.logo) && <Image src={church.logo} style={styles.logo} />}
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.text}>{church?.nombre || 'Church Name'}</Text>
          <Text style={styles.text}>{task?.title || 'Untitled Task'}</Text>
          <Text style={{
            ...styles.priority,
            backgroundColor: getPriorityColor(task?.priority || 'medium') + '20',
            color: getPriorityColor(task?.priority || 'medium'),
          }}>
            {(task?.priority || 'medium').toUpperCase()}
          </Text>
          <Text style={styles.text}>ID: {task?.id || 'Unknown'}</Text>
          <Text style={styles.text}>Status: {task?.status || 'Unknown'}</Text>
        </View>
      </Page>
    </Document>
  );
};

export default TaskQRLabel;