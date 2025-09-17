import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, getDocs, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { categoriesCollection, coursesCollection } from '../firebase';
import ChurchHeader from './ChurchHeader';
import Skeleton from 'react-loading-skeleton';

// Add this helper function at the top of your component
const getNextAvailableOrder = (courses, minOrder) => {
  const usedOrders = courses.map(c => c.order).filter(Boolean);
  let order = minOrder;
  while (usedOrders.includes(order)) {
    order++;
  }
  return order;
};

const CourseManager = () => {
  const { id } = useParams(); // This is your churchId/idIglesia
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]); // Add categories state
  const [galleries, setGalleries] = useState([]); // Add galleries state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingCourse, setEditingCourse] = useState(null);
  const [orderedCourses, setOrderedCourses] = useState([]);

  // Add these new states after your existing states
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('title');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');

  useEffect(() => {
    const initialize = async () => {
      try {
        await Promise.all([
          fetchCourses(),
          fetchCategories(),
          fetchGalleries()
        ]);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [id]);

  const fetchCategories = async () => {
    try {
      const categoriesSnap = await getDocs(
        query(collection(db, 'coursecategories'), 
        where('churchId', '==', id))
      );
      const categoriesData = categoriesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCategories(categoriesData);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchCourses = async () => {
    try {
      const coursesSnap = await getDocs(
        query(collection(db, 'courses'), 
        where('churchId', '==', id))
      );
      const coursesData = coursesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCourses(coursesData.sort((a, b) => a.order - b.order));
    } catch (err) {
      console.error('Error fetching courses:', err);
    }
  };

  const fetchGalleries = async () => {
    try {
      console.log('Fetching galleries for church:', id);
      const galleriesRef = collection(db, 'gallery_new');
      const q = query(galleriesRef, where('idIglesia', '==', id)); // Changed from churchId to idIglesia
      
      const galleriesSnap = await getDocs(q);
      const galleriesData = galleriesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      console.log('Fetched galleries:', galleriesData);
      setGalleries(galleriesData);
    } catch (err) {
      console.error('Error fetching galleries:', err);
    }
  };

  const handleUpdate = async (courseId, updatedData) => {
    try {
      const courseRef = doc(db, 'courses', courseId);
      await updateDoc(courseRef, {
        ...updatedData,
        churchId: id,
        galleryId: updatedData.galleryId || null,
        prerequisiteId: updatedData.prerequisiteId || null, // Add prerequisite
        updatedAt: serverTimestamp()
      });
      setEditingCourse(null);
      fetchCourses();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (courseId) => {
    if (window.confirm('Are you sure you want to delete this course?')) {
      try {
        await deleteDoc(doc(db, 'courses', courseId));
        fetchCourses();
      } catch (err) {
        setError(err.message);
      }
    }
  };

  // Update the handlePrerequisiteChange function
  const handlePrerequisiteChange = async (course, prerequisiteId) => {
    try {
      const prerequisiteCourse = courses.find(c => c.id === prerequisiteId);
      let updatedOrder = course.order;

      if (prerequisiteId && prerequisiteCourse) {
        // Get the minimum order based on prerequisite
        const minOrder = prerequisiteCourse.order + 1;
        
        // If current order is less than or equal to prerequisite's order
        if (!course.order || course.order <= prerequisiteCourse.order) {
          updatedOrder = getNextAvailableOrder(courses, minOrder);
        }

        // Update orders of all affected courses
        const updatedCourses = courses.map(c => {
          if (c.id === course.id) {
            return {
              ...course,
              prerequisiteId,
              order: updatedOrder
            };
          }
          // Shift other courses with same or higher order
          if (c.order >= updatedOrder && c.id !== course.id) {
            return {
              ...c,
              order: c.order + 1
            };
          }
          return c;
        });

        // Update all affected courses in Firebase
        await Promise.all(
          updatedCourses
            .filter(c => c.order !== courses.find(orig => orig.id === c.id)?.order)
            .map(c => updateDoc(doc(db, 'courses', c.id), {
              order: c.order,
              updatedAt: serverTimestamp()
            }))
        );

        setCourses(updatedCourses.sort((a, b) => a.order - b.order));
      } else {
        // If removing prerequisite, keep current order
        setCourses(courses.map(c => 
          c.id === course.id ? { ...course, prerequisiteId: null } : c
        ));
      }
    } catch (err) {
      console.error('Error updating prerequisite:', err);
      setError('Failed to update prerequisite');
    }
  };

  // Add this function after your other handler functions
  const handleImageUpload = async (e, courseId) => {
    try {
      const file = e.target.files[0];
      if (!file) return;

      // Create a reference to the storage location
      const storageRef = ref(storage, `courses/${id}/${courseId}/${Date.now()}_${file.name}`);
      
      // Upload the file
      const uploadTask = await uploadBytes(storageRef, file);
      console.log('File uploaded successfully');

      // Get the download URL
      const downloadURL = await getDownloadURL(uploadTask.ref);
      console.log('File URL:', downloadURL);

      // Update the course with the new image URL
      const updated = courses.map(c => 
        c.id === courseId 
          ? { ...c, imageUrl: downloadURL }
          : c
      );
      setCourses(updated);

      // Update in Firebase
      await updateDoc(doc(db, 'courses', courseId), {
        imageUrl: downloadURL,
        updatedAt: serverTimestamp()
      });

    } catch (error) {
      console.error('Error uploading image:', error);
      setError('Failed to upload image');
    }
  };

  // Add this function to filter and sort courses
  const getFilteredAndSortedCourses = () => {
    return courses
      .filter(course => {
        const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            course.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !selectedCategory || course.category === selectedCategory;
        const matchesSubcategory = !selectedSubcategory || course.subcategory === selectedSubcategory;
        return matchesSearch && matchesCategory && matchesSubcategory;
      })
      .sort((a, b) => {
        const aValue = a[sortField] || '';
        const bValue = b[sortField] || '';
        return sortDirection === 'asc' 
          ? aValue.toString().localeCompare(bValue.toString())
          : bValue.toString().localeCompare(aValue.toString());
      });
  };

  return (
    <div className="admin-container">
      <Link to={`/church/${id}/course-admin`} className="back-button">
        ← Back to Course Admin
      </Link>

      <ChurchHeader id={id} />

      <div className="content-box">
        <h1>Manage Courses</h1>

        <div className="filters-container">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search courses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-options">
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              className="sort-select"
            >
              <option value="title">Sort by Title</option>
              <option value="category">Sort by Category</option>
              <option value="status">Sort by Status</option>
              <option value="order">Sort by Order</option>
            </select>
            
            <button
              onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="sort-direction-btn"
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>

            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setSelectedSubcategory('');
              }}
              className="category-select"
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
            </select>

            <select
              value={selectedSubcategory}
              onChange={(e) => setSelectedSubcategory(e.target.value)}
              className="subcategory-select"
              disabled={!selectedCategory}
            >
              <option value="">All Subcategories</option>
              {categories
                .find(cat => cat.name === selectedCategory)
                ?.subcategories.map(sub => (
                  <option key={sub.name} value={sub.name}>{sub.name}</option>
                ))}
            </select>
          </div>
        </div>

        {loading ? (
          <Skeleton count={5} height={40} />
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : (
          <div className="courses-grid">
            {getFilteredAndSortedCourses().map(course => (
              <div key={course.id} className="course-card">
                {editingCourse === course.id ? (
                  <div className="course-edit-form">
                    <div className="form-group">
                      <label>Title:</label>
                      <input
                        type="text"
                        value={course.title}
                        onChange={(e) => {
                          const updated = {...course, title: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      />
                    </div>

                    <div className="form-group">
                      <label>Description:</label>
                      <textarea
                        value={course.description}
                        onChange={(e) => {
                          const updated = {...course, description: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                        rows="3"
                      />
                    </div>

                    <div className="form-group">
                      <label>Category:</label>
                      <select
                        value={course.category}
                        onChange={(e) => {
                          const updated = {...course, category: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      >
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.name}>{cat.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Subcategory:</label>
                      <select
                        value={course.subcategory}
                        onChange={(e) => {
                          const updated = {...course, subcategory: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      >
                        {categories
                          .find(cat => cat.name === course.category)
                          ?.subcategories.map(sub => (
                            <option key={sub.name} value={sub.name}>{sub.name}</option>
                          ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Content:</label>
                      <textarea
                        value={course.content}
                        onChange={(e) => {
                          const updated = {...course, content: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                        rows="10"
                      />
                    </div>

                    <div className="form-group">
                      <label>Course Image:</label>
                      <div className="image-upload-container">
                        {course.imageUrl && (
                          <div className="image-preview">
                            <img 
                              src={course.imageUrl} 
                              alt="Course preview" 
                              className="uploaded-image"
                            />
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, course.id)}
                          className="form-control-file"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Status:</label>
                      <select
                        value={course.status}
                        onChange={(e) => {
                          const updated = {...course, status: e.target.value};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="draft">Draft</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Gallery (Optional):</label>
                      <select
                        value={course.galleryId || ''}
                        onChange={(e) => {
                          const updated = {...course, galleryId: e.target.value || null};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      >
                        <option value="">Select Gallery (Optional)</option>
                        {galleries.map(gallery => (
                          <option key={gallery.id} value={gallery.id}>
                            {gallery.name || gallery.title} {/* Checking for both name and title fields */}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Order:</label>
                      <input
                        type="number"
                        value={course.order}
                        onChange={(e) => {
                          const updated = {...course, order: parseInt(e.target.value)};
                          setCourses(courses.map(c => 
                            c.id === course.id ? updated : c
                          ));
                        }}
                        className="form-control"
                      />
                    </div>

                    {/* Update the prerequisite select dropdown to show current orders */}
                    <div className="form-group">
                      <label>Prerequisite Course (Optional):</label>
                      <select
                        value={course.prerequisiteId || ''}
                        onChange={(e) => handlePrerequisiteChange(course, e.target.value)}
                        className="form-control"
                      >
                        <option value="" disabled>Select Prerequisite Course (Optional)</option>
                        {courses
                          .filter(c => 
                            c.id !== course.id && // Not the same course
                            c.subcategory === course.subcategory && // Same subcategory
                            c.order < course.order // Lower order
                          )
                          .sort((a, b) => (a.order || 0) - (b.order || 0))
                          .map(c => (
                            <option 
                              key={c.id} 
                              value={c.id}
                            >
                              {`${c.title} (Order: ${c.order || 'Unset'})`}
                            </option>
                        ))}
                      </select>
                      {course.prerequisiteId && (
                        <small className="text-muted">
                          Note: Prerequisites must be from the same subcategory and have a lower order number.
                        </small>
                      )}
                      {courses.filter(c => c.subcategory === course.subcategory).length <= 1 && (
                        <small className="text-warning">
                          No other courses available in this subcategory for prerequisites.
                        </small>
                      )}
                    </div>

                    <div className="edit-actions">
                      <button
                        onClick={() => handleUpdate(course.id, course)}
                        className="btn btn-success"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setEditingCourse(null)}
                        className="btn btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="course-card-content">
                    <div className="course-card-image">
                      {course.imageUrl ? (
                        <img 
                          src={course.imageUrl} 
                          alt={course.title}
                          className="course-thumbnail"
                        />
                      ) : (
                        <div className="course-thumbnail-placeholder">
                          No Image
                        </div>
                      )}
                    </div>
                    <div className="course-card-body">
                      <h3 className="course-card-title">{course.title}</h3>
                      <p className="course-card-description">{course.description}</p>
                      <div className="course-card-meta">
                        <span className="badge badge-primary">{course.category}</span>
                        <span className="badge badge-secondary">{course.subcategory}</span>
                        {course.galleryId && (
                          <span className="badge badge-info">
                            Gallery: {galleries.find(g => g.id === course.galleryId)?.name || 'Attached'}
                          </span>
                        )}
                        {course.prerequisiteId && (
                          <span className="badge badge-warning">
                            Prerequisite: {courses.find(c => c.id === course.prerequisiteId)?.title || 'Unknown'} 
                            (Order: {courses.find(c => c.id === course.prerequisiteId)?.order})
                          </span>
                        )}
                      </div>
                      <div className="course-card-status">
                        <span className={`status-badge status-${course.status}`}>
                          {course.status}
                        </span>
                        <span className="order-badge">
                          Order: {course.order}
                        </span>
                      </div>
                    </div>
                    <div className="course-card-actions">
                      <button
                        onClick={() => setEditingCourse(course.id)}
                        className="btn btn-warning"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(course.id)}
                        className="btn btn-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseManager;

// import React, { useState, useEffect } from 'react';
// import { useParams } from 'react-router-dom';
// import { doc, getDoc } from 'firebase/firestore';
// import { db } from '../firebase';
import './Process.css';

const Process = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processCategories, setProcessCategories] = useState([]);

  useEffect(() => {
    const fetchProcessConfig = async () => {
      try {
        setLoading(true);
        const configRef = doc(db, 'churches', id, 'config', 'process');
        const configDoc = await getDoc(configRef);
        
        if (configDoc.exists()) {
          const categoryIds = configDoc.data().categoryIds || [];
          const categoriesPromises = categoryIds.map(async (categoryId) => {
            const categoryRef = doc(db, 'coursecategories', categoryId);
            const categoryDoc = await getDoc(categoryRef);
            return categoryDoc.exists() ? { id: categoryDoc.id, ...categoryDoc.data() } : null;
          });
          
          const categories = await Promise.all(categoriesPromises);
          const validCategories = categories.filter(cat => cat !== null);
          console.log('Fetched process categories:', validCategories);
          setProcessCategories(validCategories);
        }
      } catch (error) {
        console.error('Error fetching process config:', error);
        setError('Failed to load process configuration');
      } finally {
        setLoading(false);
      }
    };

    fetchProcessConfig();
  }, [id]);

  if (loading) return <div>Loading process...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="process-container">
      <h2>Process Categories</h2>
      {processCategories.length > 0 ? (
        <div className="categories-grid">
          {processCategories.map(category => (
            <div key={category.id} className="category-card">
              <div className="category-card-content">
                <h3 className="category-card-title">{category.name}</h3>
                <p className="category-card-description">{category.description}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p>No process categories configured.</p>
      )}
    </div>
  );
};

export { Process };
// export default Process;