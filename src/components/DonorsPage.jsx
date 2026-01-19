import React, { useState } from 'react';
import DonorUploader from './DonorUploader';
import DonorManager from './DonorManager';
import { useParams } from 'react-router-dom';

const DonorsPage = () => {
  const { id } = useParams();
  const [tab, setTab] = useState('upload');

  return (
    <div style={{ padding: 20 }}>
      <h2>Donors</h2>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setTab('upload')} style={{ marginRight: 8 }} className={tab==='upload' ? 'btn' : 'btn secondary'}>Upload</button>
        <button onClick={() => setTab('manage')} className={tab==='manage' ? 'btn' : 'btn secondary'}>Manage</button>
      </div>

      {tab === 'upload' ? (
        <DonorUploader churchId={id} />
      ) : (
        <DonorManager churchId={id} />
      )}
    </div>
  );
};

export default DonorsPage;
