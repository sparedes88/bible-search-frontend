import React from 'react';
import { Link } from 'react-router-dom';
import commonStyles from '../../pages/commonStyles';
import styles from '../../styles/sections.module.css';

const SectionLayout = ({ 
  id, 
  title, 
  children, 
  onAdd, 
  addButtonText = 'Add New',
  showAddButton = true,
  user
}) => {
  const canEdit = user?.role === "global_admin" || (user?.role === "admin" && user?.churchId === id);

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}`} style={commonStyles.backButtonLink}>
        ← Back to Church Dashboard
      </Link>
      
      <div className={styles.header}>
        <h1 style={commonStyles.title}>{title}</h1>
        {showAddButton && canEdit && (
          <button 
            onClick={onAdd}
            style={commonStyles.indigoButton}
          >
            {addButtonText}
          </button>
        )}
      </div>

      {children}
    </div>
  );
};

export default SectionLayout;
