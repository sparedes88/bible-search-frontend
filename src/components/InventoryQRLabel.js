import React from 'react';
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer';
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
class InventoryQRLabel extends React.Component {
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
    if (prevProps.qrUrl !== this.props.qrUrl) {
      this.generateQRCode();
    }
  }

  generateQRCode = async () => {
    try {
      const { qrUrl } = this.props;
      const url = await QRCode.toDataURL(qrUrl || 'https://example.com', {
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
    const { item, church } = this.props;
    const { qrDataUrl, ready } = this.state;

    if (!ready) {
      return <div>Preparing QR code...</div>;
    }

    // Check for both name and nombre properties to ensure compatibility
    const churchName = church?.nombre || church?.name || 'Church Name';

    // Create document with fixed dimensions and no additional content or metadata
    return (
      <Document properties={{
        creator: 'Church Admin',
        producer: 'Church Admin',
        title: 'Inventory QR Label',
        subject: 'Inventory QR Label',
        keywords: 'inventory,qr,label',
      }}>
        <Page size={[432, 144]} style={styles.page} wrap={false}>
          <View style={styles.qrCodeContainer}>
            <Image src={qrDataUrl} style={styles.qrImage} />
          </View>          <View style={styles.textContainer}>
            <Text style={{...styles.text, fontSize: 10}}>{churchName}</Text>
            <Text style={{...styles.text, fontWeight: 'bold'}}>{item?.inventoryId || 'No ID'}</Text>
            <Text style={styles.text}>{item?.name || 'Item Name'}</Text>
            <Text style={styles.text}>
              Status: {
                item?.status === 'in_use' ? 'In Use' :
                item?.status === 'storage' ? 'In Storage' :
                item?.status === 'repair' ? 'In Repair' :
                item?.status === 'disposed' ? 'Disposed' : 
                item?.status || 'Unknown'
              }
            </Text>
          </View>
        </Page>
      </Document>
    );
  }
}

export default InventoryQRLabel;