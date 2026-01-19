import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, collection, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const ImageControls = ({ imageUrl, setImageUrl, handleImageUpload, uploadProgress }) => (
  <div className="space-y-2">
    <label className="block text-sm font-medium">Image Upload</label>
    <input
      type="file"
      accept="image/*"
      onChange={(e) => e.target.files[0] && handleImageUpload(e.target.files[0])}
      className="w-full"
    />
    {uploadProgress > 0 && (
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className="bg-blue-600 h-2.5 rounded-full" 
          style={{ width: `${uploadProgress}%` }}
        />
      </div>
    )}
    <input
      type="text"
      value={imageUrl}
      onChange={(e) => setImageUrl(e.target.value)}
      placeholder="Or enter image URL"
      className="w-full p-2 border rounded"
    />
  </div>
);

const VideoControls = ({ videoUrl, setVideoUrl }) => (
  <div className="space-y-2">
    <label className="block text-sm font-medium">Video URL</label>
    <input
      type="text"
      value={videoUrl}
      onChange={(e) => setVideoUrl(e.target.value)}
      placeholder="Enter video URL"
      className="w-full p-2 border rounded"
    />
  </div>
);

const BroadcastView3 = ({ isControl = false }) => {
  const { id, broadcastId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mediaType, setMediaType] = useState('none');
  const [videoUrl, setVideoUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPosition, setCameraPosition] = useState('full');
  const screenStreamRef = useRef(null);

  useEffect(() => {
    if (!id || !broadcastId) return;

    const broadcastRef = doc(db, `churches/${id}/broadcasts`, broadcastId);
    const unsubscribe = onSnapshot(broadcastRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setMediaType(data.mediaType || 'none');
        setVideoUrl(data.videoUrl || '');
        setImageUrl(data.imageUrl || '');
        setShowCamera(data.showCamera || false);
        setCameraPosition(data.cameraPosition || 'full');
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [id, broadcastId]);

  const handleImageUpload = async (file) => {
    try {
      const storage = getStorage();
      const imageRef = ref(storage, `broadcasts/${id}/${broadcastId}/images/${file.name}`);
      
      const uploadTask = uploadBytesResumable(imageRef, file);
      
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          setError('Failed to upload image');
        },
        async () => {
          const downloadUrl = await getDownloadURL(imageRef);
          setImageUrl(downloadUrl);
          await updateDoc(doc(db, `churches/${id}/broadcasts`, broadcastId), {
            imageUrl: downloadUrl,
            mediaType: 'image'
          });
          setUploadProgress(0);
        }
      );
    } catch (err) {
      console.error('Image upload error:', err);
      setError('Failed to upload image');
    }
  };

  const handleScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      
      screenStreamRef.current = stream;
      setMediaType('screen');
      
      stream.getVideoTracks()[0].onended = () => {
        setMediaType('none');
        screenStreamRef.current = null;
      };
    } catch (err) {
      console.error('Screen share error:', err);
      setError('Failed to start screen sharing');
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div className="fixed inset-0 flex">
      {isControl && (
        <div className="w-96 bg-white shadow-xl p-4 overflow-y-auto">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {['none', 'video', 'camera', 'screen', 'image'].map(type => (
                <button
                  key={type}
                  onClick={() => type === 'screen' ? handleScreenShare() : setMediaType(type)}
                  className={`p-2 rounded capitalize ${
                    mediaType === type ? 'bg-blue-500 text-white' : 'bg-gray-100'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {mediaType === 'image' && (
              <ImageControls 
                imageUrl={imageUrl}
                setImageUrl={setImageUrl}
                handleImageUpload={handleImageUpload}
                uploadProgress={uploadProgress}
              />
            )}

            {mediaType === 'video' && (
              <VideoControls 
                videoUrl={videoUrl}
                setVideoUrl={setVideoUrl}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex-1 bg-gray-900">
        {mediaType === 'video' && videoUrl && (
          <video
            src={videoUrl}
            className="w-full h-full"
            controls={isControl}
            autoPlay
          />
        )}

        {mediaType === 'image' && imageUrl && (
          <img
            src={imageUrl}
            alt="Broadcast"
            className="w-full h-full object-contain"
          />
        )}

        {mediaType === 'screen' && screenStreamRef.current && (
          <video
            ref={screenVideoRef}
            autoPlay
            className="w-full h-full"
          />
        )}
      </div>
    </div>
  );
};

export default BroadcastView3;