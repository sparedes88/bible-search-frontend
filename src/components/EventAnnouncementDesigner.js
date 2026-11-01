import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { MdAddPhotoAlternate, MdArrowBack, MdAutoAwesome, MdCheck, MdClose, MdDownload, MdRefresh, MdSend, MdWarningAmber } from 'react-icons/md';
import { toast } from 'react-toastify';
import { auth, db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatAnnouncementDate, formatAnnouncementTime } from '../utils/eventAnnouncementLayout';
import { updateEventDesign } from '../utils/eventSeriesDesign';
import { downloadEventImage } from '../utils/downloadEventImage';
import { getAppliedDesignDetails, getEventDesignChanges, getEventDesignDetails, getEventImageChanges } from '../utils/eventDesignDetails';
import './EventAnnouncementDesigner.css';

export { formatAnnouncementTime } from '../utils/eventAnnouncementLayout';

const CONCEPTS = [
  { name: 'Editorial' },
  { name: 'Community' },
  { name: 'Spotlight' },
];
const FUNCTIONS_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? '/firebase-api' : 'https://us-central1-igletechv1.cloudfunctions.net';
const resolveImage = async value => !value ? '' : /^https?:\/\//i.test(value)
  ? value : getDownloadURL(ref(storage, String(value).replace(/^\//, '')));
const errorMessage = error => /prepay|credits.*deplet|billing/i.test(error.message || '')
  ? 'OpenAI API credits are unavailable. Check your API project billing and usage limits.'
  : error.message || 'Could not generate this design. Please retry.';
const formatCost = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);

export const buildOpenAIAnnouncementPrompt = (event, brand, index, instruction = '', previousBrief = '', referenceImages = []) => {
  const title = event.instanceTitle || event.title || '';
  const compositions = [
    'Editorial: confident expressive headline typography, disciplined magazine-inspired composition, sophisticated whitespace, understated brand accents and one purposeful photographic scene.',
    'Community: welcoming photographic composition, beautifully balanced title and information, warm natural imagery, approachable but refined type hierarchy.',
    'Spotlight: bold typographic composition with striking visual hierarchy, dramatic subject imagery, high contrast and restrained brand accents.',
  ];
  return [
    'Design ONE complete, finished professional event announcement for a television screen: landscape 16:9, final delivery 1920x1080 Full HD (1080p). The whole composition must be horizontal, never portrait or square. Create the entire graphic design including typography, imagery, logo placement and all event text. Do not return an artwork-only background, mockup, collage of options or a generic boxed template.',
    instruction ? '' : 'Create a completely new original composition for this event. Do not inherit parameters, artwork or feedback from an earlier design or another module.',
    `This is unique option ${index + 1} of 3. Make this concept genuinely distinct in composition, typography and visual treatment, not merely a color variant of the other directions.`,
    compositions[index],
    `Organization: ${brand.name}. ${brand.colors.length ? `Brand palette: ${brand.colors.join(', ')}.` : 'Derive the brand accents from the supplied official logo.'}`,
    brand.logoUrl ? 'The official logo is supplied as a reference. Include it faithfully, preserving its actual shape, lettering, colors and proportions. It is not a poster template: do not copy its background or use it as the whole layout.' : 'No logo is supplied. Do not invent one.',
    referenceImages.length ? `Attached image order: ${instruction ? 'the selected design, then ' : ''}${brand.logoUrl ? 'the official organization logo, then ' : ''}the uploaded images listed below in order.` : '',
    ...referenceImages.map((image, imageIndex) => `Uploaded image ${imageIndex + 1} (${JSON.stringify(image.name)}): ${image.mode === 'reference'
      ? 'STYLE REFERENCE ONLY. Use its composition, visual mood or palette as inspiration. Do not copy its event wording, dates, logos or other factual details.'
      : 'ADD TO DESIGN. Incorporate this actual supplied image or photograph into the finished announcement. Preserve the subject and recognizable people or objects; do not replace them with unrelated stock imagery. Integrate it cleanly with the event typography.'}`),
    'The design must be CLEAN, UNIQUE and professionally art-directed: one strong focal point, intentional alignment, refined readable typography, generous purposeful spacing and minimal decoration. Avoid clutter, unnecessary slogans, dense paragraphs and generic templates. Use only a few clearly separated information blocks.',
    'TV readability is mandatory: a large headline and large high-contrast date/time readable from across a room. Keep every word and the entire logo at least 96 pixels inside every edge of the final 1920x1080 canvas for TV overscan safety. No cropped or overlapping elements. Use the full widescreen composition without black bars or frames.',
    'Render ONLY the supplied event facts, in the language of the event. Never invent speakers, addresses, prices, URLs or dates. Omit empty fields, do not insert placeholders or Online for a missing venue. Show every time in the exact 12-hour AM/PM format provided, never military time.',
    'DATE FORMAT OVERRIDE: Always render dates exactly as supplied in English Month DD, YYYY format, for example November 01, 2026. Preserve the two-digit day and comma. Never translate dates into Spanish or another language, even when the event title and other copy are Spanish. Keep the rest of the event copy in its original language.',
    JSON.stringify({ title, date: formatAnnouncementDate(event.startDate), endDate: event.endDate !== event.startDate ? formatAnnouncementDate(event.endDate) : '', startTime: formatAnnouncementTime(event.startHour), endTime: formatAnnouncementTime(event.endHour), location: event.location || '', description: event.description || '' }),
    instruction && previousBrief ? `Previous feedback in this design conversation: ${previousBrief}` : '',
    instruction ? `Refine the supplied selected announcement using this feedback: ${instruction}. Preserve correct event facts and the official logo. You may adjust composition, imagery and typography to satisfy the feedback.` : '',
  ].filter(Boolean).join('\n\n');
};

const EventAnnouncementDesigner = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const freshDesign = searchParams.get('fresh') === '1';
  const { user, loading: authLoading } = useAuth();
  const [event, setEvent] = useState(null);
  const [brand, setBrand] = useState(null);
  const [options, setOptions] = useState([]);
  const [generationCost, setGenerationCost] = useState(null);
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [newOptionIndexes, setNewOptionIndexes] = useState([]);
  const [newDesignPrompt, setNewDesignPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [generatingIndex, setGeneratingIndex] = useState(-1);
  const [optionStages, setOptionStages] = useState({});
  const [imageStages, setImageStages] = useState({});
  const [downloadingImages, setDownloadingImages] = useState({});
  const [referenceImages, setReferenceImages] = useState([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const referenceInput = useRef(null);
  const roles = [user?.role, user?.baseRole, user?.basedOn].map(role => String(role || '').toLowerCase());
  const canManage = Boolean(user && (roles.includes('global_admin') || (roles.includes('admin') && String(user.churchId || user.churchID || user.organizationId || '') === String(id))));
  const selectedCost = options[selected]?.billing?.usd;
  const selectedCostKnown = typeof selectedCost === 'number' && Number.isFinite(selectedCost) && selectedCost >= 0;
  const trackedCostKnown = generationCost && generationCost.generations > (generationCost.unknownGenerations || 0) && typeof generationCost.usd === 'number' && Number.isFinite(generationCost.usd);
  const appliedImageChanges = getEventImageChanges(event);
  const selectedDesignChanges = getEventDesignChanges(event, options[selected]?.eventDetails || event?.announcementDesignEventDetails);
  const imageChanges = [...new Set([...appliedImageChanges, ...selectedDesignChanges])];

  useEffect(() => {
    if (authLoading || !canManage) return;
    return onSnapshot(doc(db, 'eventInstances', eventId), snapshot => {
      const current = snapshot.exists() ? snapshot.data() : null;
      setGenerationCost(current?.announcementGenerationCost || null);
      if (current && String(current.churchId) === String(id)) setEvent(previous => previous ? { ...previous, ...current } : previous);
    }, () => setGenerationCost(null));
  }, [id, eventId, canManage, authLoading]);

  useEffect(() => {
    if (authLoading || !canManage) return;
    let active = true;
    const load = async () => {
      try {
        const [eventSnapshot, organizationSnapshot] = await Promise.all([
          getDoc(doc(db, 'eventInstances', eventId)),
          getDoc(doc(db, 'churches', id)),
        ]);
        if (!eventSnapshot.exists() || String(eventSnapshot.data().churchId) !== String(id)) throw new Error('Event not found in this organization.');
        const data = eventSnapshot.data();
        const organization = organizationSnapshot.exists() ? organizationSnapshot.data() : {};
        const logoUrl = await resolveImage(organization.logoUrl || organization.logo);
        const colors = (Array.isArray(organization.brandColors) ? organization.brandColors : []).filter(color => /^#[0-9a-f]{6}$/i.test(color));
        let savedDesigns = Array.isArray(data.announcementDesigns) ? data.announcementDesigns.slice(0, 3) : [];
        if (!savedDesigns.some(design => design.imageUrl) && data.imageUrl) {
          const currentImage = {
            imageUrl: await resolveImage(data.imageUrl),
            imagePath: data.imageUrl,
            provider: 'current-image',
            eventDetails: getAppliedDesignDetails(data) || getEventDesignDetails(data),
            inheritedGraphic: Boolean(data.recurrenceSeriesId && !data.isRecurrenceMaster && !data.imageIsSeriesOverride),
          };
          savedDesigns = [{ ...currentImage, versions: [currentImage] }];
        }
        if (!active) return;
        setEvent(data);
        setBrand({ name: organization.nombre || organization.name || '', logoUrl, colors });
        setOptions(savedDesigns);
        setReferenceImages(Array.isArray(data.announcementReferenceImages) ? data.announcementReferenceImages.slice(0, 3) : []);
      } catch (error) {
        if (active) setLoadError(error.message || 'Could not load the event.');
      }
    };
    load();
    return () => { active = false; };
  }, [id, eventId, authLoading, canManage]);

  const saveReferenceImages = async images => {
    await updateDoc(doc(db, 'eventInstances', eventId), { announcementReferenceImages: images });
    setReferenceImages(images);
  };

  const uploadReferenceImages = async change => {
    const files = Array.from(change.target.files || []);
    change.target.value = '';
    if (!files.length || busy || saving || uploadingReferences || !canManage || !event) return;
    if (files.length + referenceImages.length > 3) {
      setReferenceError('You can attach up to three images.');
      return;
    }
    if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      setReferenceError('Select PNG, JPEG, or WebP images.');
      return;
    }
    if (files.some(file => file.size >= 5 * 1024 * 1024)) {
      setReferenceError('Each image must be smaller than 5MB.');
      return;
    }
    setUploadingReferences(true);
    setReferenceError('');
    let images = [...referenceImages];
    try {
      for (const [index, file] of files.entries()) {
        const referenceId = `${Date.now()}-${index}`;
        const imagePath = `events/${id}/${eventId}/reference-${referenceId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
        const imageReference = ref(storage, imagePath);
        await uploadBytes(imageReference, file, { contentType: file.type });
        const imageUrl = await getDownloadURL(imageReference);
        images = [...images, { id: referenceId, name: file.name, imagePath, imageUrl, mode: 'include' }];
        await saveReferenceImages(images);
      }
    } catch (error) {
      setReferenceError('Could not upload all images. Successfully saved images are still available.');
    } finally {
      setUploadingReferences(false);
    }
  };

  const changeReferenceImages = async images => {
    if (busy || saving || uploadingReferences || !canManage) return;
    setUploadingReferences(true);
    setReferenceError('');
    try {
      await saveReferenceImages(images);
    } catch (error) {
      setReferenceError('Could not update the image attachments. Please retry.');
    } finally {
      setUploadingReferences(false);
    }
  };

  const generate = async (indexes, instruction = '', newBrief = '') => {
    if (busy || uploadingReferences || !canManage || !event || !brand) return;
    setBusy(true);
    setGenerationError('');
    setOptionStages(previous => ({ ...previous, ...Object.fromEntries(indexes.map(index => [index, 'queued'])) }));
    let current = [...options];
    let activeIndex = indexes[0];
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Please sign in again before generating a design.');
      for (const index of indexes) {
        activeIndex = index;
        setGeneratingIndex(index);
        setOptionStages(previous => ({ ...previous, [index]: 'generating' }));
        const previous = current[index];
        const prompt = [buildOpenAIAnnouncementPrompt(event, brand, index, instruction, previous?.brief || '', referenceImages), newBrief ? `New design direction: ${newBrief}` : ''].filter(Boolean).join('\n\n');
        const previousImageUrl = instruction ? previous?.imageUrl || '' : '';
        const response = await fetch(`${FUNCTIONS_BASE}/generateEventDesignWithOpenAI`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ churchId: id, eventId, prompt, previousImageUrl, referenceImageUrls: [...(brand.logoUrl ? [brand.logoUrl] : []), ...referenceImages.map(image => image.imageUrl)] }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || payload.error || payload.details?.error?.message || 'OpenAI could not generate the design.');
        if (!payload.imageBase64) throw new Error('No image was returned. Please retry.');
        setOptionStages(previous => ({ ...previous, [index]: 'saving' }));
        const mimeType = ['image/png', 'image/jpeg', 'image/webp'].includes(payload.mimeType) ? payload.mimeType : 'image/png';
        const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
        const timestamp = Date.now();
        const imagePath = `events/${id}/${eventId}/announcement-${index}-${timestamp}.${extension}`;
        const bytes = Uint8Array.from(atob(payload.imageBase64), character => character.charCodeAt(0));
        const composed = new Blob([bytes], { type: mimeType });
        if (composed.size >= 5 * 1024 * 1024) throw new Error('The image exceeds the 5MB upload limit. Please regenerate it.');
        const imageRef = ref(storage, imagePath);
        await uploadBytes(imageRef, composed, { contentType: mimeType });
        const imageUrl = await getDownloadURL(imageRef);
        const eventDetails = getEventDesignDetails(event);
        const version = { imageUrl, imagePath, provider: 'openai', model: payload.model || '', width: payload.width || 1920, height: payload.height || 1080, billing: payload.billing || null, referenceImages, eventDetails, inheritedGraphic: false, layoutVersion: 4, brief: instruction ? [previous?.brief, instruction].filter(Boolean).join('\n') : newBrief, createdAt: new Date().toISOString() };
        current = CONCEPTS.map((concept, optionIndex) => optionIndex === index
          ? { ...version, name: concept.name, versions: [...(previous?.versions || []), version].slice(-8) }
          : current[optionIndex] || { name: concept.name });
        await updateDoc(doc(db, 'eventInstances', eventId), { announcementDesigns: current, announcementDesignEventDetails: eventDetails });
        setOptionStages(previous => ({ ...previous, [index]: 'loading' }));
        setOptions(current);
      }
      if (instruction) setFeedback('');
    } catch (error) {
      setGenerationError(errorMessage(error));
      setOptionStages(previous => Object.fromEntries(Object.entries(previous).map(([index, stage]) => [index,
        Number(index) === activeIndex ? 'error' : stage === 'queued' ? 'paused' : stage,
      ])));
    } finally {
      setBusy(false);
      setGeneratingIndex(-1);
    }
  };

  useEffect(() => {
    if (freshDesign) {
      setSearchParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('fresh');
        return next;
      }, { replace: true });
    }
  }, [freshDesign, setSearchParams]);

  const useDesign = async () => {
    if (!options[selected]?.imagePath || busy || saving || uploadingReferences || !canManage) return;
    setSaving(true);
    try {
      await updateEventDesign(id, { ...event, id: eventId }, options[selected].imagePath, options[selected].eventDetails || event.announcementDesignEventDetails || getEventDesignDetails(event));
      toast.success('Event image updated successfully');
      navigate(`/organization/${id}/all-events`);
    } catch (error) {
      setGenerationError('Could not update the event image. Your designs are still saved.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) return <main className="event-designer"><p role="status">Loading...</p></main>;
  if (!canManage) return <main className="event-designer"><p role="alert">Only event managers can design event announcements.</p></main>;

  return (
    <main className="event-designer">
      <header className="event-designer-header">
        <button type="button" className="event-designer-button" onClick={() => navigate(`/organization/${id}/all-events`)} disabled={busy || saving || uploadingReferences}><MdArrowBack /> Back to events</button>
        <div className="event-designer-brand">
          {brand?.logoUrl && <img src={brand.logoUrl} alt={`${brand.name} logo`} />}
          <span>{brand?.name}</span>
          <div className="event-designer-colors">{brand?.colors.map(color => <span key={color} style={{ backgroundColor: color }} title={color} />)}</div>
        </div>
      </header>
      <div className="event-designer-heading">
        <div><h1>{event?.instanceTitle || event?.title || 'Event announcement'}</h1><p>{[event?.startDate, [formatAnnouncementTime(event?.startHour), formatAnnouncementTime(event?.endHour)].filter(Boolean).join(' - '), event?.location].filter(Boolean).join(' | ')}</p></div>
        <button type="button" className="event-designer-button" disabled={busy || saving || uploadingReferences || !event} onClick={() => setNewOptionIndexes([0, 1, 2])}><MdRefresh /> New options</button>
      </div>
      <div className="event-designer-format"><span>OpenAI</span><span>1920 x 1080 / Full HD</span></div>
      {event?.recurrenceSeriesId && !event.isRecurrenceMaster && <p className="event-designer-scope">Editing this occurrence only{options[selected]?.inheritedGraphic ? ' / Starting from master graphic' : ''}</p>}
      {newOptionIndexes.length > 0 && (
        <form className="event-designer-new-prompt" aria-label="New design options" onSubmit={submit => {
          submit.preventDefault();
          if (!newDesignPrompt.trim() || busy || saving || uploadingReferences) return;
          const indexes = [...newOptionIndexes];
          setNewOptionIndexes([]);
          generate(indexes, '', newDesignPrompt.trim());
        }}>
          <label htmlFor="event-new-design-prompt">New design prompt</label>
          <textarea id="event-new-design-prompt" value={newDesignPrompt} onChange={change => setNewDesignPrompt(change.target.value)} rows={3} placeholder="Describe the design you want to create..." required autoFocus />
          <div className="event-designer-new-prompt-actions">
            <button type="button" className="event-designer-button" onClick={() => setNewOptionIndexes([])}>Cancel</button>
            <button type="submit" className="event-designer-button event-designer-primary" disabled={!newDesignPrompt.trim() || busy || saving || uploadingReferences}><MdAutoAwesome /> {newOptionIndexes.length === 3 ? 'Generate 3 options' : `Generate ${CONCEPTS[newOptionIndexes[0]].name} option`}</button>
          </div>
        </form>
      )}
      {imageChanges.length > 0 && (
        <section className="event-designer-outdated" role="status" aria-label="Image needs updating">
          <MdWarningAmber aria-hidden="true" />
          <div><strong>Image needs updating</strong><p>Event details changed: {imageChanges.join(', ')}. Update the design to match the current event.</p>
            {appliedImageChanges.length > 0 && selectedDesignChanges.length === 0 && options[selected]?.imageUrl && <small>The image on All Events still needs to be replaced with an updated design.</small>}
          </div>
        </section>
      )}
      <section className="event-designer-cost" aria-label="Design cost" aria-live="polite">
        <div><span>Selected design estimate (USD)</span><strong>{selectedCostKnown ? formatCost(selectedCost) : 'Cost not recorded'}</strong></div>
        <div><span>Tracked event total, including revisions (USD)</span><strong>{trackedCostKnown ? formatCost(generationCost.usd) : generationCost?.generations > 0 ? 'Cost unavailable' : 'Not recorded yet'}</strong></div>
        <small>OpenAI usage-based estimates. Excludes unrecorded earlier generations, taxes and hosting.</small>
        {generationCost?.unknownGenerations > 0 && <small>{generationCost.unknownGenerations} generation(s) without pricing data.</small>}
        {options[selected]?.billing?.tracked === false && <small>This generation is not included in the tracked total.</small>}
      </section>
      <section className="event-designer-references" aria-label="Design images">
        <div className="event-designer-reference-heading">
          <div><h2>Design images</h2><small>{referenceImages.length} / 3 images</small></div>
          <button type="button" className="event-designer-button" disabled={busy || saving || uploadingReferences || referenceImages.length >= 3 || !event} onClick={() => referenceInput.current.click()}><MdAddPhotoAlternate /> Upload images</button>
        </div>
        <input ref={referenceInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload design images" disabled={busy || saving || uploadingReferences || referenceImages.length >= 3 || !event} onChange={uploadReferenceImages} />
        {uploadingReferences && <div className="event-designer-reference-upload" role="status">Saving images...<progress aria-label="Image attachments upload progress" /></div>}
        {referenceError && <p className="event-designer-error" role="alert">{referenceError}</p>}
        <div className="event-designer-reference-list">
          {referenceImages.map(image => <article key={image.id} className="event-designer-reference">
            <img src={image.imageUrl} alt={image.name} />
            <div className="event-designer-reference-name"><span title={image.name}>{image.name}</span><button type="button" aria-label={`Remove ${image.name}`} title={`Remove ${image.name}`} disabled={busy || saving || uploadingReferences} onClick={() => changeReferenceImages(referenceImages.filter(reference => reference.id !== image.id))}><MdClose size={20} /></button></div>
            <select aria-label={`Image use for ${image.name}`} value={image.mode} disabled={busy || saving || uploadingReferences} onChange={change => changeReferenceImages(referenceImages.map(reference => reference.id === image.id ? { ...reference, mode: change.target.value } : reference))}>
              <option value="include">Add to design</option><option value="reference">Style reference</option>
            </select>
          </article>)}
        </div>
      </section>
      {loadError && <p className="event-designer-error" role="alert">{loadError}</p>}
      {generationError && <p className="event-designer-error" role="alert">{generationError}</p>}
      {!event && !loadError && <p role="status">Loading event and branding...</p>}
      <div className="event-designer-options" aria-label="Announcement options">
        {CONCEPTS.map((concept, index) => {
          const imageUrl = options[index]?.imageUrl;
          const requestStage = optionStages[index];
          const stage = ['queued', 'generating', 'saving', 'error', 'paused'].includes(requestStage)
            ? requestStage : imageUrl ? imageStages[imageUrl] || 'loading' : 'idle';
          const labels = { idle: 'Not started', queued: 'Queued', generating: 'Generating design...', saving: 'Saving design...', loading: 'Loading image...', complete: 'Ready', error: 'Generation failed', imageError: 'Image failed to load', paused: 'Waiting to retry' };
          const active = ['generating', 'saving', 'loading'].includes(stage);
          return (
          <article key={concept.name} className={`event-designer-option${selected === index ? ' is-selected' : ''}`} aria-busy={active}>
            <button type="button" className="event-designer-preview" aria-label={`Select ${concept.name} design`} aria-pressed={selected === index} onClick={() => setSelected(index)} disabled={busy || !options[index]?.imageUrl}>
              {imageUrl ? <img key={imageUrl} src={imageUrl} alt={`${concept.name} announcement for ${event?.title || 'event'}`} onLoad={() => setImageStages(previous => ({ ...previous, [imageUrl]: 'complete' }))} onError={() => setImageStages(previous => ({ ...previous, [imageUrl]: 'imageError' }))} /> : <span className="event-designer-placeholder"><MdAutoAwesome size={32} /><span>No design yet</span></span>}
            </button>
            <div className="event-designer-option-footer">
              <div><strong>{index + 1}. {concept.name}</strong>{imageUrl && <small className="event-designer-source">{options[index].inheritedGraphic ? 'Shared master graphic' : options[index].provider === 'current-image' ? 'Current image' : options[index].provider === 'openai' ? 'OpenAI' : 'Gemini'}</small>}{imageUrl && getEventDesignChanges(event, options[index].eventDetails || event?.announcementDesignEventDetails).length > 0 && <small className="event-designer-stale-label">Update needed</small>}</div>
              <div className="event-designer-option-actions">
                <button type="button" aria-label={`Download ${concept.name} design`} title={downloadingImages[index] ? 'Downloading image...' : 'Download image'} disabled={!imageUrl || downloadingImages[index]} aria-busy={Boolean(downloadingImages[index])} onClick={async () => {
                  if (!imageUrl || downloadingImages[index]) return;
                  setDownloadingImages(previous => ({ ...previous, [index]: true }));
                  try {
                    await downloadEventImage(imageUrl, `${event?.instanceTitle || event?.title || 'Event'} - ${concept.name}`);
                  } catch (error) {
                    toast.error(error.message || 'Could not download image');
                  } finally {
                    setDownloadingImages(previous => ({ ...previous, [index]: false }));
                  }
                }}><MdDownload size={20} /></button>
                <button type="button" aria-label={`Regenerate ${concept.name} design`} title={`Regenerate ${concept.name} design`} disabled={busy || saving || uploadingReferences || !event} onClick={() => setNewOptionIndexes([index])}><MdRefresh size={20} /></button>
              </div>
            </div>
            <div className="event-designer-progress" data-stage={stage}>
              <span role="status">{labels[stage]}</span>
              <progress aria-label={`${concept.name} design progress`} aria-valuetext={labels[stage]} max={100} value={active ? undefined : stage === 'complete' ? 100 : 0} />
            </div>
          </article>
          );
        })}
      </div>
      {busy && <p className="event-designer-status" role="status">{generatingIndex >= 0 ? `Creating ${CONCEPTS[generatingIndex].name} TV announcement with OpenAI...` : 'Preparing designs...'}</p>}
      <section className="event-designer-refinement" aria-label="Refine selected design">
        <div className="event-designer-feedback">
          <label htmlFor="event-design-feedback">Refine {CONCEPTS[selected].name}</label>
          <textarea id="event-design-feedback" value={feedback} onChange={change => setFeedback(change.target.value)} placeholder="More about the event, wording, layout, or changes..." disabled={busy || saving || uploadingReferences} rows={3} />
          <div className="event-designer-versions">{options[selected]?.versions?.map((version, index) => <button key={`${version.imagePath}-${index}`} type="button" className="event-designer-button" disabled={busy || saving} aria-pressed={options[selected].imagePath === version.imagePath} onClick={() => setOptions(previous => previous.map((option, optionIndex) => optionIndex === selected ? { ...option, ...version, billing: version.billing || null } : option))}>Version {index + 1}</button>)}</div>
        </div>
        <div className="event-designer-actions">
          <button type="button" className="event-designer-button" disabled={busy || saving || uploadingReferences || !feedback.trim() || !options[selected]?.imageUrl} onClick={() => generate([selected], feedback.trim())}><MdSend /> Refine design</button>
          <button type="button" className="event-designer-button event-designer-primary" disabled={busy || saving || uploadingReferences || !options[selected]?.imagePath} onClick={useDesign}><MdCheck /> {saving ? 'Saving...' : 'Use this design'}</button>
        </div>
      </section>
    </main>
  );
};

export default EventAnnouncementDesigner;