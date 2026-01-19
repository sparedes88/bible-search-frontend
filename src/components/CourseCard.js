import React from 'react';
import { categoriesCollection, coursesCollection } from '../firebase';
import { Link } from 'react-router-dom';

const CourseCard = ({ course, churchId }) => {
  return (
    <div className="course-card">
      <div className="course-image-container">
        <img 
          src={course.imageUrl || '/default-course.jpg'} 
          alt={course.title}
          className="course-image"
        />
        <div className="course-category-badge">
          {course.category}
        </div>
      </div>
      <div className="course-content">
        <h3 className="course-title">{course.title}</h3>
        <p className="course-description">{course.description}</p>
        <div className="course-meta">
          <span className="course-subcategory">{course.subcategory}</span>
        </div>
        <Link 
          to={`/church/${churchId}/courses/${course.id}`} 
          className="course-link"
        >
          View Course →
        </Link>
      </div>
    </div>
  );
};

export default CourseCard;