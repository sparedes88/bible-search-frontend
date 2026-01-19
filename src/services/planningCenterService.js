import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, writeBatch, orderBy, limit, startAfter } from 'firebase/firestore';

const PROXY_URL = '/firebase-api/planningCenterProxy';

/**
 * Planning Center Service
 * Handles all Planning Center API interactions via Firebase Cloud Function proxy
 */

/**
 * Helper function to call Planning Center API via proxy
 */
async function callPlanningCenterAPI(appId, secret, endpoint, method = 'GET', body = null) {
  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId,
        secret,
        endpoint,
        method,
        body
      })
    });

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Planning Center API request failed');
    }

    return result.data;
  } catch (error) {
    console.error('Error calling Planning Center API:', error);
    throw error;
  }
}

export const planningCenterService = {
  /**
   * Get Planning Center credentials for an organization
   */
  async getCredentials(organizationId) {
    try {
      const configRef = doc(db, 'churches', organizationId, 'config', 'planningCenter');
      const configSnap = await getDoc(configRef);
      
      if (configSnap.exists()) {
        return configSnap.data();
      }
      return null;
    } catch (error) {
      console.error('Error fetching Planning Center credentials:', error);
      throw error;
    }
  },

  /**
   * Save Planning Center credentials
   */
  async saveCredentials(organizationId, appId, secret) {
    try {
      const configRef = doc(db, 'churches', organizationId, 'config', 'planningCenter');
      await setDoc(configRef, {
        appId,
        secret,
        connected: true,
        lastSync: null,
        updatedAt: new Date().toISOString()
      });
      return true;
    } catch (error) {
      console.error('Error saving Planning Center credentials:', error);
      throw error;
    }
  },

  /**
   * Save field mappings and location preferences
   */
  async saveMappings(organizationId, fieldMappings = {}, locationPrefs = {}) {
    try {
      const configRef = doc(db, 'churches', organizationId, 'config', 'planningCenter');
      await setDoc(configRef, {
        fieldMappings,
        locationPrefs,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (error) {
      console.error('Error saving Planning Center mappings:', error);
      throw error;
    }
  },

  /**
   * Get field mappings and preferences
   */
  async getMappings(organizationId) {
    try {
      const configRef = doc(db, 'churches', organizationId, 'config', 'planningCenter');
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          fieldMappings: data.fieldMappings || {},
          locationPrefs: data.locationPrefs || { email: 'home', phone: 'mobile', address: 'home' }
        };
      }
      return { fieldMappings: {}, locationPrefs: { email: 'home', phone: 'mobile', address: 'home' } };
    } catch (error) {
      console.error('Error fetching Planning Center mappings:', error);
      return { fieldMappings: {}, locationPrefs: { email: 'home', phone: 'mobile', address: 'home' } };
    }
  },

  /**
   * Test API connection
   */
  async testConnection(appId, secret) {
    try {
      await callPlanningCenterAPI(appId, secret, '/people/v2/me');
      return true;
    } catch (error) {
      console.error('Error testing Planning Center connection:', error);
      return false;
    }
  },

  /**
   * Fetch people from Planning Center
   */
  async fetchPeople(appId, secret, options = {}) {
    try {
      const params = new URLSearchParams({
        per_page: options.perPage || 100,
        offset: options.offset || 0,
        // Include additional fields that Planning Center requires explicit requesting
        include: 'addresses,emails,phone_numbers',
        ...options.filters
      });

      const data = await callPlanningCenterAPI(
        appId,
        secret,
        `/people/v2/people?${params}`
      );

      return data;
    } catch (error) {
      console.error('Error fetching people from Planning Center:', error);
      throw error;
    }
  },

  /**
   * Fetch additional person data (addresses, avatar)
   */
  async fetchPersonDetails(appId, secret, personId, personObject) {
    const details = {
      addresses: [],
      emails: [],
      phones: [],
      avatar: null,
      warnings: []
    };

    try {
      // Fetch addresses
      const addressData = await callPlanningCenterAPI(
        appId,
        secret,
        `/people/v2/people/${personId}/addresses`
      );
      if (addressData?.data && Array.isArray(addressData.data)) {
        details.addresses = addressData.data;
      }
    } catch (error) {
      details.warnings.push(`Failed to fetch addresses: ${error.message}`);
    }

    try {
      // Fetch emails
      const emailData = await callPlanningCenterAPI(
        appId,
        secret,
        `/people/v2/people/${personId}/emails`
      );
      if (emailData?.data && Array.isArray(emailData.data)) {
        details.emails = emailData.data;
      }
    } catch (error) {
      details.warnings.push(`Failed to fetch emails: ${error.message}`);
    }

    try {
      // Fetch phone numbers
      const phoneData = await callPlanningCenterAPI(
        appId,
        secret,
        `/people/v2/people/${personId}/phone_numbers`
      );
      if (phoneData?.data && Array.isArray(phoneData.data)) {
        details.phones = phoneData.data;
      }
    } catch (error) {
      details.warnings.push(`Failed to fetch phone numbers: ${error.message}`);
    }

    try {
      // Get avatar from person object or links
      const avatarUrl = personObject?.attributes?.avatar || personObject?.links?.avatar;
      if (avatarUrl) {
        details.avatar = avatarUrl;
      }
    } catch (error) {
      details.warnings.push(`Failed to fetch avatar: ${error.message}`);
    }

    return details;
  },

  /**
   * Sync a single person from Planning Center
   */
  async syncPerson(organizationId, person, credentials, mappingConfig = {}) {
    const syncReport = {
      success: false,
      warnings: [],
      fieldsSynced: [],
      fieldsMissing: []
    };

    try {
  // Fetch additional details (addresses, emails, phones, avatar)
      const details = await this.fetchPersonDetails(credentials.appId, credentials.secret, person.id, person);
      syncReport.warnings.push(...details.warnings);

      // Get primary address if available
      let addressData = {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'US'
      };

      if (details.addresses.length > 0) {
        // Use first address marked as primary, or first address
        const primaryAddr = details.addresses.find(a => a.attributes?.primary) || details.addresses[0];
        if (primaryAddr?.attributes) {
          const attrs = primaryAddr.attributes;
          console.log('Planning Center address for', person.attributes.first_name, person.attributes.last_name);
          console.log('  - Raw address data:', attrs);
          console.log('  - Street:', attrs.street || attrs.line1 || attrs.line_1);
          console.log('  - City:', attrs.city);
          console.log('  - State:', attrs.state);
          console.log('  - Zip:', attrs.zip || attrs.postal_code);
          
          addressData = {
            street: attrs.street || attrs.line1 || attrs.line_1 || '',
            city: attrs.city || '',
            state: attrs.state || '',
            zipCode: attrs.zip || attrs.postal_code || '',
            country: attrs.country || 'US'
          };
          
          console.log('  - Mapped addressData:', addressData);
        }
      } else {
        console.log('No addresses found in Planning Center for', person.attributes.first_name, person.attributes.last_name);
      }

  // Build a flat map of available values (including by-location keys)
  const flat = {};

  // Derive primary email from details (fallback to person attributes if available)
      let derivedEmail = '';
      if (Array.isArray(details.emails) && details.emails.length > 0) {
        const primaryEmail = details.emails.find(e => e.attributes?.primary) || details.emails[0];
        derivedEmail = primaryEmail?.attributes?.address || '';
      }

  // Derive primary phone from details (prefer mobile)
      let derivedPhone = '';
      // Add flat contact keys
      flat.primaryEmail = derivedEmail;
      flat.primary_contact_email = person.attributes.primary_contact_email || '';
      flat.primaryPhone = derivedPhone;
      flat.primary_contact_phone = person.attributes.primary_contact_phone || '';

      // Expand emails into flat keys (by index and location)
      if (Array.isArray(details.emails)) {
        details.emails.forEach((e, idx) => {
          const addr = e?.attributes?.address || '';
          const loc = (e?.attributes?.location || '').toLowerCase();
          flat[`email_${idx}`] = addr;
          if (loc) {
            const key = `email_${loc}`;
            if (!flat[key]) flat[key] = addr;
          }
        });
      }

      // Expand phones into flat keys (by index and location)
      if (Array.isArray(details.phones)) {
        details.phones.forEach((p, idx) => {
          const num = p?.attributes?.number || '';
          const loc = (p?.attributes?.location || '').toLowerCase();
          flat[`phone_${idx}`] = num;
          if (loc) {
            const key = `phone_${loc}`;
            if (!flat[key]) flat[key] = num;
          }
        });
      }

      // Add flat personal keys
      const pcGender = person.attributes.gender || person.attributes.sex || '';
      const normalizedGender = pcGender ? pcGender.toLowerCase() : '';
      flat.gender = normalizedGender;
      flat.sex = (person.attributes.sex || '').toLowerCase();
      flat.birthdate = person.attributes.birthdate || '';

      // Add flat address keys including fallbacks
      flat.street = addressData.street || '';
      flat.line1 = addressData.street || '';
      flat.line_1 = addressData.street || '';
      flat.city = addressData.city || '';
      flat.state = addressData.state || '';
      flat.zip = addressData.zipCode || '';
      flat.postal_code = addressData.zipCode || '';
      flat.country = addressData.country || 'US';

      // Expand addresses by location if available
      if (Array.isArray(details.addresses)) {
        details.addresses.forEach((a) => {
          const at = a?.attributes || {};
          const loc = (at.location || '').toLowerCase();
          if (!loc) return;
          const setIfEmpty = (k, v) => { if (!flat[k]) flat[k] = v || ''; };
          setIfEmpty(`street_${loc}`, at.street || at.line1 || at.line_1 || '');
          setIfEmpty(`line1_${loc}`, at.line1 || at.line_1 || at.street || '');
          setIfEmpty(`line_1_${loc}`, at.line_1 || at.line1 || at.street || '');
          setIfEmpty(`city_${loc}`, at.city || '');
          setIfEmpty(`state_${loc}`, at.state || '');
          setIfEmpty(`zip_${loc}`, at.zip || at.postal_code || '');
          setIfEmpty(`postal_code_${loc}`, at.postal_code || at.zip || '');
          setIfEmpty(`country_${loc}`, at.country || '');
        });
      }

      // Apply strict location preferences (no fallbacks)
      const mapFields = mappingConfig.fieldMappings || {};
      const locationPrefs = (mappingConfig.locationPrefs || { email: 'home', phone: 'mobile', address: 'home' });

      // Email by location
      let finalEmail = '';
      if (Array.isArray(details.emails) && details.emails.length > 0) {
        const targetEmail = details.emails.find(e => (e.attributes?.location || '').toLowerCase() === String(locationPrefs.email || '').toLowerCase());
        finalEmail = targetEmail?.attributes?.address || '';
      }

      // Phone by location
      let finalPhone = '';
      if (Array.isArray(details.phones) && details.phones.length > 0) {
        const targetPhone = details.phones.find(p => (p.attributes?.location || '').toLowerCase() === String(locationPrefs.phone || '').toLowerCase());
        finalPhone = targetPhone?.attributes?.number || '';
      }

      // DOB and gender strictly by mapped field (no fallback chain)
      const finalDOB = flat[mapFields.birthdate || 'birthdate'] || '';
      const finalGender = (flat[mapFields.gender || 'sex'] || '').toLowerCase();

      // Address by location
      let finalStreet = '';
      let finalCity = '';
      let finalState = '';
      let finalZip = '';
      let finalCountry = 'US';
      if (Array.isArray(details.addresses) && details.addresses.length > 0) {
        const targetAddr = details.addresses.find(a => (a.attributes?.location || '').toLowerCase() === String(locationPrefs.address || '').toLowerCase());
        if (targetAddr?.attributes) {
          const a = targetAddr.attributes;
          finalStreet = a.street || a.line1 || a.line_1 || '';
          finalCity = a.city || '';
          finalState = a.state || '';
          finalZip = a.zip || a.postal_code || '';
          finalCountry = a.country || 'US';
        }
      }
      // derivedPhone no longer used for final selection

      // Track what fields have data
      if (person.attributes.first_name) syncReport.fieldsSynced.push('first_name');
      else syncReport.fieldsMissing.push('first_name');
      
      if (person.attributes.last_name) syncReport.fieldsSynced.push('last_name');
      else syncReport.fieldsMissing.push('last_name');
      
  if (finalEmail) syncReport.fieldsSynced.push('email');
      else syncReport.fieldsMissing.push('email');
      
  if (finalPhone) syncReport.fieldsSynced.push('phone');
      else syncReport.fieldsMissing.push('phone');
      
  if (finalStreet || finalCity) syncReport.fieldsSynced.push('address');
      else syncReport.fieldsMissing.push('address');
      
  if (finalDOB) syncReport.fieldsSynced.push('birthdate');
      else syncReport.fieldsMissing.push('birthdate');
      
  // Check gender present based on selected mapping
  if (finalGender) syncReport.fieldsSynced.push('gender');
      else syncReport.fieldsMissing.push('gender');
      
      if (details.avatar) syncReport.fieldsSynced.push('avatar');
      else syncReport.fieldsMissing.push('avatar');

      // Prefer matching by Planning Center ID
      let existing = await this.findExistingPersonByPCId(organizationId, person.id);
      if (!existing) {
        existing = await this.findExistingMemberByPCId(organizationId, person.id);
      }
      if (!existing) {
        // Fallback to basic matching by name/email: visitors first, then members
        existing = await this.findExistingVisitorByNameEmail(
          organizationId,
          person.attributes.first_name,
          person.attributes.last_name,
          person.attributes.primary_contact_email
        );
        if (!existing) {
          existing = await this.findExistingMemberByNameEmail(
            organizationId,
            person.attributes.first_name,
            person.attributes.last_name,
            person.attributes.primary_contact_email
          );
        }
      }

      // Log available attributes for debugging field mapping
      console.log('Planning Center person attributes:', {
        id: person.id,
        name: `${person.attributes.first_name} ${person.attributes.last_name}`,
        availableFields: Object.keys(person.attributes).filter(k => person.attributes[k]),
        gender: person.attributes.gender,
        sex: person.attributes.sex // Planning Center might use 'sex' instead of 'gender'
      });

      // Store both raw and normalized gender in planningCenterData for display logic
      const enhancedPCData = {
        ...person.attributes,
        gender: finalGender, // normalized
        street: finalStreet,
        city: finalCity,
        state: finalState,
        zipCode: finalZip,
        country: finalCountry,
        primaryEmail: finalEmail,
        primaryPhone: finalPhone
      };
      
      const personData = {
        name: person.attributes.first_name || '',
        lastName: person.attributes.last_name || '',
        email: finalEmail,
        phone: finalPhone,
        dateOfBirth: finalDOB,
        gender: finalGender,
        address: {
          street: finalStreet,
          city: finalCity,
          state: finalState,
          zipCode: finalZip,
          country: finalCountry
        },
        avatar: details.avatar || '',
        planningCenterId: person.id,
        planningCenterData: enhancedPCData,
        syncedAt: new Date().toISOString(),
        isSynced: true
      };

      // Ensure Planning Center tag
      const planningTag = 'planning_center';
      const ensureTags = (tags) => {
        const set = new Set([...(tags || [])]);
        set.add(planningTag);
        return Array.from(set);
      };

      if (existing) {
        if (existing.isVisitor) {
          // Update existing visitor; backfill createdAt if missing
          const personRef = doc(db, 'visitors', organizationId, 'visitors', existing.id);
          const updatePayload = {
            ...personData,
            tags: ensureTags(existing.tags)
          };
          if (!existing.createdAt) {
            updatePayload.createdAt = serverTimestamp();
          }
          
          console.log('Updating visitor:', person.attributes.first_name, person.attributes.last_name);
          console.log('  - Address in update payload:', updatePayload.address);
          
          await updateDoc(personRef, updatePayload);
          syncReport.success = true;
          return { ...existing, ...personData, updated: true, isVisitor: true, syncReport };
        } else {
          // Update existing member (users collection)
          const userRef = doc(db, 'users', existing.id);
          const updatePayload = {
            ...personData,
            tags: ensureTags(existing.tags)
          };
          
          console.log('Updating member:', person.attributes.first_name, person.attributes.last_name);
          console.log('  - Address in update payload:', updatePayload.address);
          
          await updateDoc(userRef, updatePayload);
          syncReport.success = true;
          return { ...existing, ...personData, updated: true, isVisitor: false, syncReport };
        }
      } else {
        // Create new visitor for brand new person
        const visitorRef = doc(collection(db, 'visitors', organizationId, 'visitors'));
        await setDoc(visitorRef, {
          ...personData,
          churchId: organizationId,
          dateAdded: new Date().toISOString(),
          createdAt: serverTimestamp(),
          notes: [],
          status: 'active',
          isMember: false,
          tags: ensureTags([])
        });
        syncReport.success = true;
        return { id: visitorRef.id, ...personData, created: true, isVisitor: true, syncReport };
      }
    } catch (error) {
      console.error('Error syncing person:', error);
      syncReport.success = false;
      syncReport.warnings.push(`Sync failed: ${error.message}`);
      return { error: error.message, syncReport };
    }
  },

  /**
   * Find existing person by Planning Center ID in visitors
   */
  async findExistingPersonByPCId(organizationId, planningCenterId) {
    try {
      if (!planningCenterId) return null;
      const visitorsRef = collection(db, 'visitors', organizationId, 'visitors');
      const qSnap = await getDocs(query(visitorsRef, where('planningCenterId', '==', planningCenterId)));
      if (!qSnap.empty) {
        const d = qSnap.docs[0];
        return { id: d.id, ...d.data(), isVisitor: true };
      }
      return null;
    } catch (error) {
      console.error('Error finding existing person by PC ID:', error);
      return null;
    }
  },

  /**
   * Fallback: find existing visitor by name/email
   */
  async findExistingVisitorByNameEmail(organizationId, firstName, lastName, email) {
    try {
      const visitorsRef = collection(db, 'visitors', organizationId, 'visitors');
      // Fallback: scan visitors; we avoid additional filters to ensure we don't miss older records lacking planningCenterId
      const visitorSnap = await getDocs(visitorsRef);
      for (const d of visitorSnap.docs) {
        const data = d.data();
        if (
          data.name === firstName &&
          data.lastName === lastName &&
          (data.email === email || !email)
        ) {
          return { id: d.id, ...data, isVisitor: true };
        }
      }
      return null;
    } catch (error) {
      console.error('Error finding existing visitor by name/email:', error);
      return null;
    }
  },

  /**
   * Find existing member by Planning Center ID in users
   */
  async findExistingMemberByPCId(organizationId, planningCenterId) {
    try {
      if (!planningCenterId) return null;
      const usersRef = collection(db, 'users');
      // Prefer scoping by churchId when present
      const usersSnap = await getDocs(usersRef);
      for (const d of usersSnap.docs) {
        const data = d.data();
        if ((data.churchId === organizationId || !data.churchId) && data.planningCenterId === planningCenterId) {
          return { id: d.id, ...data, isVisitor: false };
        }
      }
      return null;
    } catch (error) {
      console.error('Error finding existing member by PC ID:', error);
      return null;
    }
  },

  /**
   * Fallback: find existing member by name/email
   */
  async findExistingMemberByNameEmail(organizationId, firstName, lastName, email) {
    try {
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      for (const d of usersSnap.docs) {
        const data = d.data();
        const sameOrg = (data.churchId === organizationId || !data.churchId);
        const emailMatch = email ? data.email === email : true;
        if (sameOrg && emailMatch && data.name === firstName && data.lastName === lastName) {
          return { id: d.id, ...data, isVisitor: false };
        }
      }
      return null;
    } catch (error) {
      console.error('Error finding existing member by name/email:', error);
      return null;
    }
  },

  /**
   * Sync all people from Planning Center
   */
  async syncAllPeople(organizationId, appId, secret, onProgress) {
    try {
      // Load mapping configuration once for the whole sync
      const mappingConfig = await this.getMappings(organizationId);
      let offset = 0;
      let hasMore = true;
      let totalSynced = 0;
      const results = {
        created: 0,
        updated: 0,
        errors: 0,
        createdVisitors: 0,
        updatedVisitors: 0,
        updatedMembers: 0,
      };

      // Create sync log header
      const logsCol = collection(db, 'churches', organizationId, 'pcSyncLogs');
      const logRef = await addDoc(logsCol, {
        status: 'running',
        startAt: serverTimestamp(),
        results: results,
      });
      const entriesCol = collection(logRef, 'entries');
      let entryBuffer = [];
      const flushEntries = async () => {
        if (entryBuffer.length === 0) return;
        // Use batched writes
        const batch = writeBatch(db);
        entryBuffer.forEach(entry => {
          const eRef = doc(entriesCol);
          batch.set(eRef, entry);
        });
        await batch.commit();
        entryBuffer = [];
      };

      while (hasMore) {
        const data = await this.fetchPeople(appId, secret, { offset });
        
        for (const person of data.data) {
          try {
            const result = await this.syncPerson(organizationId, person, { appId, secret }, mappingConfig);
            if (result.created) {
              results.created++;
              results.createdVisitors++;
            }
            if (result.updated) {
              results.updated++;
              if (result.isVisitor) results.updatedVisitors++; else results.updatedMembers++;
            }
            totalSynced++;
            
            // Build detailed entry with sync report
            const entry = {
              at: serverTimestamp(),
              action: result.created ? 'created' : (result.updated ? 'updated' : 'none'),
              personId: person.id,
              targetId: result.id || null,
              name: `${person.attributes.first_name || ''} ${person.attributes.last_name || ''}`.trim(),
              email: person.attributes.primary_contact_email || '',
              phone: person.attributes.primary_contact_phone || '',
              isVisitor: result.isVisitor,
            };

            // Add sync report details
            if (result.syncReport) {
              entry.syncReport = {
                success: result.syncReport.success,
                fieldsSynced: result.syncReport.fieldsSynced,
                fieldsMissing: result.syncReport.fieldsMissing,
                warnings: result.syncReport.warnings
              };
            }

            entryBuffer.push(entry);
            
            if (entryBuffer.length >= 200) {
              await flushEntries();
            }
            
            if (onProgress) {
              onProgress({ totalSynced, results });
            }
          } catch (error) {
            console.error('Error syncing person:', person.id, error);
            results.errors++;
            entryBuffer.push({
              at: serverTimestamp(),
              action: 'error',
              personId: person.id,
              error: error.message || String(error),
              isVisitor: null,
              name: `${person.attributes?.first_name || ''} ${person.attributes?.last_name || ''}`.trim(),
            });
          }
        }

        hasMore = data.data.length === 100;
        offset += 100;
      }

      await flushEntries();

      // Update last sync time
      const configRef = doc(db, 'churches', organizationId, 'config', 'planningCenter');
      await updateDoc(configRef, {
        lastSync: new Date().toISOString(),
        lastSyncResults: results
      });

      // Finalize log
      await updateDoc(logRef, {
        status: 'completed',
        endAt: serverTimestamp(),
        results: results
      });

      return results;
    } catch (error) {
      console.error('Error syncing all people:', error);
      throw error;
    }
  },

  /**
   * Preview counts before syncing (estimates for new vs updates)
   */
  async previewSync(organizationId, appId, secret) {
    try {
      // Build a set of existing planningCenterId from visitors and members (users)
      const visitorsRef = collection(db, 'visitors', organizationId, 'visitors');
      const existingVisitorsSnap = await getDocs(query(visitorsRef, where('planningCenterId', '!=', null)));
      const visitorIds = new Set(existingVisitorsSnap.docs.map(d => d.data().planningCenterId).filter(Boolean));

      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const memberIds = new Set(
        usersSnap.docs
          .map(d => d.data())
          .filter(u => (u.churchId === organizationId || !u.churchId) && u.planningCenterId)
          .map(u => u.planningCenterId)
      );

      const existingIds = new Set([...visitorIds, ...memberIds]);

      let offset = 0;
      let hasMore = true;
      let toCreate = 0;
      let toUpdate = 0;
      let total = 0;

      while (hasMore) {
        const data = await this.fetchPeople(appId, secret, { offset });
        for (const person of data.data) {
          total++;
          if (existingIds.has(person.id)) toUpdate++; else toCreate++;
        }
        hasMore = data.data.length === 100;
        offset += 100;
      }

      return { total, toCreate, toUpdate };
    } catch (error) {
      console.error('Error previewing sync:', error);
      throw error;
    }
  },

  /**
   * Check if a person is synced with Planning Center
   */
  async checkSyncStatus(organizationId, personId, isVisitor = true) {
    try {
      const personRef = isVisitor
        ? doc(db, 'visitors', organizationId, 'visitors', personId)
        : doc(db, 'users', personId);
      
      const personSnap = await getDoc(personRef);
      
      if (personSnap.exists()) {
        const data = personSnap.data();
        return {
          isSynced: !!data.planningCenterId,
          planningCenterId: data.planningCenterId || null,
          syncedAt: data.syncedAt || null
        };
      }
      
      return { isSynced: false, planningCenterId: null, syncedAt: null };
    } catch (error) {
      console.error('Error checking sync status:', error);
      return { isSynced: false, planningCenterId: null, syncedAt: null };
    }
  }
};

export default planningCenterService;
