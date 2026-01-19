import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { query, where, getDocs } from 'firebase/firestore';
import { db, getCategoriesCollection, getCoursesCollection } from '../firebase';
import CourseCard from './CourseCard';
import ChurchHeader from './ChurchHeader';

const Courses = () => {
  const { id } = useParams();
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSubcategory, setSelectedSubcategory] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setError('Church ID is required');
        setLoading(false);
        return;
      }

      try {
        // Fetch categories
        const categoriesRef = getCategoriesCollection(id);
        const categoriesSnap = await getDocs(query(categoriesRef));
        const categoriesData = categoriesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCategories(categoriesData);

        // Fetch courses
        const coursesRef = getCoursesCollection(id);
        const coursesSnap = await getDocs(query(coursesRef));
        const coursesData = coursesSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCourses(coursesData);
      } catch (error) {
        console.error('Error fetching data:', error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleHelpClick = () => {
    alert('Need help? Contact our support team at support@example.com');
  };

  const filteredCourses = courses.filter(course => {
    if (selectedCategory === 'all') return true;
    if (selectedSubcategory === 'all') 
      return course.category === selectedCategory;
    return course.category === selectedCategory && 
           course.subcategory === selectedSubcategory;
  });

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div className="admin-container">
      <ChurchHeader id={id} />
      
      <div className="content-box">
        <div className="header-section">
          <h1>Courses</h1>
          <button 
            onClick={handleHelpClick}
            className="help-button"
          >
            Help
          </button>
        </div>

        <div className="filter-section">
          <select 
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedSubcategory('all');
            }}
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.name}>{cat.name}</option>
            ))}
          </select>

          {selectedCategory !== 'all' && (
            <select
              value={selectedSubcategory}
              onChange={(e) => setSelectedSubcategory(e.target.value)}
            >
              <option value="all">All Subcategories</option>
              {categories
                .find(cat => cat.name === selectedCategory)
                ?.subcategories.map(sub => (
                  <option key={sub.name} value={sub.name}>{sub.name}</option>
                ))}
            </select>
          )}
        </div>

        {filteredCourses.length > 0 ? (
          <div className="courses-grid">
            {filteredCourses.map(course => (
              <CourseCard 
                key={course.id} 
                course={course} 
                churchId={id}
              />
            ))}
          </div>
        ) : (
          <div className="no-courses-message" style={{
            padding: '2rem',
            textAlign: 'center',
            background: '#f9fafb',
            borderRadius: '0.5rem',
            margin: '1rem 0',
            color: '#6b7280'
          }}>
            <p>No courses available. {selectedCategory !== 'all' || selectedSubcategory !== 'all' ? 'Try changing your filter settings.' : ''}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Courses;