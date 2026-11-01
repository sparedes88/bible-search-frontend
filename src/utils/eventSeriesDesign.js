import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getEventDesignDetails, getSharedDesignDetails } from './eventDesignDetails';

export const updateEventDesign = async (organizationId, event, imageUrl, eventDetails = getEventDesignDetails(event)) => {
  const targets = new Map([[event.id, event]]);
  if (event.isRecurrenceMaster && event.useMasterDesignForSeries && event.recurrenceSeriesId) {
    const snapshot = await getDocs(query(
      collection(db, 'eventInstances'),
      where('recurrenceSeriesId', '==', event.recurrenceSeriesId)
    ));
    snapshot.docs.forEach(eventDocument => {
      const instance = eventDocument.data();
      if (String(instance.churchId) === String(organizationId) && instance.recurrenceSeriesId === event.recurrenceSeriesId && !instance.removed && !instance.isDeleted && !instance.imageIsSeriesOverride) {
        if (eventDocument.id !== event.id) targets.set(eventDocument.id, instance);
      }
    });
  }
  await Promise.all([...targets].map(([eventId, instance]) => updateDoc(doc(db, 'eventInstances', eventId), {
    imageUrl,
    imageEventDetails: eventId === event.id ? eventDetails : getSharedDesignDetails(instance, eventDetails),
    imageIsSeriesOverride: eventId === event.id && Boolean(event.recurrenceSeriesId && !event.isRecurrenceMaster),
  })));
  return new Set(targets.keys());
};