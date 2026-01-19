import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

// Sample churches data
const sampleChurches = [
  {
    nombre: "Iglesia Central de Bogotá",
    location: "Bogotá, Colombia",
    headerImage: "/img/banner-fallback.svg",
    logo: "/img/logo-fallback.svg",
    description: "Una iglesia dedicada a servir a la comunidad local",
    createdAt: new Date(),
    active: true,
    version: "newchurchv1"
  },
  {
    nombre: "Iglesia del Valle",
    location: "Medellín, Colombia",
    headerImage: "/img/banner-fallback.svg",
    logo: "/img/logo-fallback.svg",
    description: "Centro espiritual en el corazón del valle",
    createdAt: new Date(),
    active: true,
    version: "newchurchv1"
  },
  {
    nombre: "Iglesia Monte Sinaí",
    location: "Cali, Colombia",
    headerImage: "/img/banner-fallback.svg",
    logo: "/img/logo-fallback.svg",
    description: "Una iglesia con visión de crecimiento espiritual",
    createdAt: new Date(),
    active: true,
    version: "newchurchv1"
  },
  {
    nombre: "Iglesia Nueva Esperanza",
    location: "Barranquilla, Colombia",
    headerImage: "/img/banner-fallback.svg",
    logo: "/img/logo-fallback.svg",
    description: "Esperanza y fe para todos",
    createdAt: new Date(),
    active: true,
    version: "newchurchv1"
  },
  {
    nombre: "Iglesia San Pablo",
    location: "Cartagena, Colombia",
    headerImage: "/img/banner-fallback.svg",
    logo: "/img/logo-fallback.svg",
    description: "Siguiendo los pasos del apóstol Pablo",
    createdAt: new Date(),
    active: true,
    version: "newchurchv1"
  }
];

async function addSampleChurches() {
  try {
    console.log('Adding sample churches to Firestore...');

    for (const church of sampleChurches) {
      const docRef = await addDoc(collection(db, "churches"), church);
      console.log(`✅ Added church: ${church.nombre} with ID: ${docRef.id}`);
    }

    console.log('🎉 All sample churches added successfully!');
  } catch (error) {
    console.error('❌ Error adding sample churches:', error);
  }
}

// Export the function so it can be called
export { addSampleChurches };

// If running directly, execute the function
if (typeof window !== 'undefined') {
  // Browser environment - make it available globally for console testing
  window.addSampleChurches = addSampleChurches;
  console.log('💡 Sample churches function loaded! Run addSampleChurches() in the console to add test data.');
}
