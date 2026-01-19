import React from 'react';
import { Page, Text, Document, StyleSheet, Image, View } from '@react-pdf/renderer';
import { QRCodeSVG } from "qrcode.react";

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

  React.useEffect(() => {
    const generateQR = async () => {
      try {
        const svg = document.querySelector('#task-qr-code svg');
        if (svg) {
          const svgData = new XMLSerializer().serializeToString(svg);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            setQrDataURL(canvas.toDataURL());
          };
          img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
        }
      } catch (err) {
        console.error('Error generating QR code:', err);
      }
    };
    generateQR();
  }, [qrUrl]);

  return (
    <Document>
      <Page size={{ width: 432, height: 144 }} style={styles.page}>
        <View style={styles.qrCodeContainer}>
          <div id="task-qr-code" style={{ display: 'none' }}>
            <QRCodeSVG value={qrUrl} size={200} level="H" />
          </div>
          {qrDataURL && <Image src={qrDataURL} />}
          {church?.logo && <Image src={church.logo} style={styles.logo} />}
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.text}>{church?.nombre || 'Church Name'}</Text>
          <Text style={styles.text}>{task.title}</Text>
          <Text style={{
            ...styles.priority,
            backgroundColor: getPriorityColor(task.priority) + '20',
            color: getPriorityColor(task.priority),
          }}>
            {task.priority.toUpperCase()}
          </Text>
          <Text style={styles.text}>ID: {task.id}</Text>
          <Text style={styles.text}>Status: {task.status}</Text>
        </View>
      </Page>
    </Document>
  );
};

export default TaskQRLabel;