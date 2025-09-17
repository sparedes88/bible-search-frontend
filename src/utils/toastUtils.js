// Toast utility file to standardize and fix toast notification issues
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Standard toast configuration
export const toastConfig = {
  position: "top-right",
  autoClose: 3000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  pauseOnFocusLoss: false, // Prevent pausing on focus loss which can cause stale references
  theme: "light",
  limit: 3
};

// Safe wrapper for toast functions
export const safeToast = {
  success: (message) => {
    if (toast && typeof toast.success === 'function') {
      return toast.success(message, toastConfig);
    }
    console.log(`Success: ${message}`);
  },
  error: (message) => {
    if (toast && typeof toast.error === 'function') {
      return toast.error(message, toastConfig);
    }
    console.log(`Error: ${message}`);
  },
  warning: (message) => {
    if (toast && typeof toast.warning === 'function') {
      return toast.warning(message, toastConfig);
    }
    console.log(`Warning: ${message}`);
  },
  info: (message) => {
    if (toast && typeof toast.info === 'function') {
      return toast.info(message, toastConfig);
    }
    console.log(`Info: ${message}`);
  }
};

// Standard ToastContainer with safety settings
export const SafeToastContainer = () => (
  <ToastContainer
    position="top-right"
    autoClose={3000}
    hideProgressBar={false}
    newestOnTop={true}
    closeOnClick
    rtl={false}
    pauseOnFocusLoss={false}
    draggable={true}
    pauseOnHover={true}
    theme="light"
    limit={3}
    enableMultiContainer={false} // Use single container to prevent issues
  />
);

export default safeToast;