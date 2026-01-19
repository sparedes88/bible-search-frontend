import React, { useState } from 'react';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const CardForm = ({ onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    imageUrl: '',
  });
  const [isUploading, setIsUploading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const storage = getStorage();
      const timestamp = Date.now();
      const imageRef = ref(storage, `churches/cards/${timestamp}_${file.name}`);
      
      await uploadBytes(imageRef, file);
      const downloadUrl = await getDownloadURL(imageRef);
      
      setFormData(prev => ({
        ...prev,
        imageUrl: downloadUrl
      }));
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="card-form bg-white p-6 rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold mb-4">Add New Card</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Title</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            rows="3"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Image</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="mt-1 block w-full"
          />
          {isUploading && <p className="text-sm text-gray-500">Uploading...</p>}
          {formData.imageUrl && (
            <img 
              src={formData.imageUrl} 
              alt="Preview" 
              className="mt-2 h-32 w-32 object-cover rounded"
            />
          )}
        </div>
        
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => onCancel()}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(formData)}
            disabled={isUploading || !formData.title}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Add Card
          </button>
        </div>
      </div>
    </div>
  );
};

export default CardForm;