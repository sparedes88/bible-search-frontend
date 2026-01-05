import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    try {
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Error navigating home:', error);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback 
          error={this.state.error} 
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
          onGoHome={this.handleGoHome}
        />
      );
    }

    return this.props.children;
  }
}

// User-friendly error fallback component
function ErrorFallback({ error, errorInfo, onReset, onGoHome }) {

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '600px',
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '3rem',
        borderRadius: '16px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>⚠️</div>
        <h1 style={{ 
          fontSize: '2rem', 
          fontWeight: '700', 
          marginBottom: '1rem', 
          color: '#1F2937' 
        }}>
          Something Went Wrong
        </h1>
        <p style={{ 
          color: '#6b7280', 
          marginBottom: '2rem', 
          fontSize: '1.1rem',
          lineHeight: '1.6'
        }}>
          We encountered an error while loading this page. Please try again.
        </p>

        {process.env.NODE_ENV === 'development' && error && (
          <details style={{
            marginBottom: '2rem',
            textAlign: 'left',
            backgroundColor: '#F9FAFB',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: '0.875rem'
          }}>
            <summary style={{ cursor: 'pointer', fontWeight: '600', marginBottom: '0.5rem' }}>
              Error Details (Development Only)
            </summary>
            <pre style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#DC2626',
              fontSize: '0.75rem',
              overflow: 'auto',
              maxHeight: '200px'
            }}>
              {error.toString()}
              {errorInfo?.componentStack}
            </pre>
          </details>
        )}

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onReset}
            style={{
              backgroundColor: '#4F46E5',
              color: 'white',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '1rem'
            }}
          >
            Try Again
          </button>
          <button
            onClick={onGoHome}
            style={{
              backgroundColor: '#F3F4F6',
              color: '#374151',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '1rem'
            }}
          >
            Go Home
          </button>
          <button
            onClick={() => {
              try {
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              } catch (error) {
                console.error('Error reloading page:', error);
              }
            }}
            style={{
              backgroundColor: '#F3F4F6',
              color: '#374151',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '500',
              fontSize: '1rem'
            }}
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;