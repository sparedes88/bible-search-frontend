import { formatAnnouncementDate, formatAnnouncementTime } from './eventAnnouncementLayout';

const normalizeText = value => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeDate = value => formatAnnouncementDate(value) || normalizeText(value);
const normalizeTime = value => formatAnnouncementTime(value) || normalizeText(value);

export const getEventDesignDetails = event => ({
  title: normalizeText(event?.title || event?.instanceTitle),
  displayTitle: normalizeText(event?.instanceTitle || event?.title),
  startDate: normalizeDate(event?.startDate),
  endDate: normalizeDate(event?.endDate || event?.startDate),
  startTime: normalizeTime(event?.startHour),
  endTime: normalizeTime(event?.endHour),
  location: normalizeText(event?.location),
  description: normalizeText(event?.description),
  campus: normalizeText(event?.campusId || event?.campusName),
  room: normalizeText(event?.roomId || event?.roomName),
});

export const getEventDesignChanges = (event, savedDetails) => {
  if (!savedDetails || typeof savedDetails !== 'object') return [];
  const current = getEventDesignDetails(event);
  const labels = { title: 'Title', displayTitle: 'Title', startDate: 'Date', endDate: 'Date', startTime: 'Time', endTime: 'Time', location: 'Location', description: 'Description', campus: 'Venue', room: 'Venue' };
  return [...new Set(Object.keys(labels).filter(key => savedDetails[key] !== current[key]).map(key => labels[key]))];
};

export const getAppliedDesignDetails = event => {
  if (event?.imageEventDetails) return event.imageEventDetails;
  const matchingDesign = event?.announcementDesigns?.flatMap(design => [design, ...(design.versions || [])])
    .find(design => design.imagePath === event.imageUrl || design.imageUrl === event.imageUrl);
  return matchingDesign?.eventDetails || null;
};

export const getEventImageChanges = event => {
  if (event?.imageUrl) return getEventDesignChanges(event, getAppliedDesignDetails(event));
  return [...new Set((event?.announcementDesigns || []).flatMap(design => getEventDesignChanges(event, design.eventDetails || event.announcementDesignEventDetails)))];
};

export const getEventDesignBaselines = event => ({
  ...(event?.imageUrl ? { imageEventDetails: getAppliedDesignDetails(event) || getEventDesignDetails(event) } : {}),
  ...(event?.announcementDesigns?.some(design => design.imageUrl) ? { announcementDesignEventDetails: event.announcementDesignEventDetails || getEventDesignDetails(event) } : {}),
});

export const getSharedDesignDetails = (instance, sourceDetails) => ({
  ...sourceDetails,
  startDate: getEventDesignDetails(instance).startDate,
  endDate: getEventDesignDetails(instance).endDate,
});