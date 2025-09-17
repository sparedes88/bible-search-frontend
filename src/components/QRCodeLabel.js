import React from 'react';
import { Document, Page, View, Text, StyleSheet, Image, PDFViewer } from '@react-pdf/renderer';
import QRCode from 'qrcode';

// Create styles with minimal dimensions to prevent overflow
const styles = StyleSheet.create({
  page: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    margin: 0,
    padding: 0,
  },
  qrCodeContainer: {
    width: '40%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
  },
  textContainer: {
    width: '60%',
    paddingLeft: 10,
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
    marginBottom: 5,
  },
  qrImage: {
    width: 130, // Slightly smaller to avoid any overflow
    height: 130,
  },
});

// Simple QR code component
class QRCodeLabel extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      qrDataUrl: null,
      ready: false
    };
  }

  componentDidMount() {
    this.generateQRCode();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.qrValue !== this.props.qrValue) {
      this.generateQRCode();
    }
  }

  generateQRCode = async () => {
    try {
      const { qrValue } = this.props;
      const url = await QRCode.toDataURL(qrValue || 'empty', {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 256, // More standard size
      });
      
      this.setState({ 
        qrDataUrl: url,
        ready: true
      });
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  };

  render() {
    const { userName, church } = this.props;
    const { qrDataUrl, ready } = this.state;

    if (!ready) {
      return <div>Preparing QR code...</div>;
    }

    // Create document with fixed dimensions and no additional content or metadata
    return (
      <Document properties={{
        creator: 'Church Admin',
        producer: 'Church Admin',
        // Set these properties to minimize metadata and avoid extra pages
        title: 'QR Label',
        subject: 'QR Label',
        keywords: 'qr,label',
      }}>
        <Page size={[432, 144]} style={styles.page} wrap={false}>
          <View style={styles.qrCodeContainer}>
            <Image src={qrDataUrl} style={styles.qrImage} />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.text}>{church?.nombre || 'Church Name'}</Text>
            <Text style={styles.text}>{userName}</Text>
            <Text style={styles.text}>ID: {this.props.qrValue}</Text>
          </View>
        </Page>
      </Document>
    );
  }
}

export default QRCodeLabel;
