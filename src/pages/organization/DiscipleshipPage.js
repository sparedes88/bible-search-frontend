import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import commonStyles from '../commonStyles';

const DiscipleshipPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [users, setUsers] = useState([]); // Legacy fallback names
  const [disciplers, setDisciplers] = useState([]);
  const [disciples, setDisciples] = useState([]);
  const [relationships, setRelationships] = useState([]);

  const [selectedDisciplerId, setSelectedDisciplerId] = useState('');
  const [selectedDiscipleIds, setSelectedDiscipleIds] = useState([]);

  const [newDisciplerName, setNewDisciplerName] = useState('');
  const [newDisciplerEmail, setNewDisciplerEmail] = useState('');
  const [newDiscipleName, setNewDiscipleName] = useState('');
  const [newDiscipleEmail, setNewDiscipleEmail] = useState('');

  const [addingDiscipler, setAddingDiscipler] = useState(false);
  const [addingDisciple, setAddingDisciple] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const usersById = useMemo(() => {
    return users.reduce((acc, member) => {
      acc[member.id] = member;
      return acc;
    }, {});
  }, [users]);

  const disciplersById = useMemo(() => {
    return disciplers.reduce((acc, discipler) => {
      acc[discipler.id] = discipler;
      return acc;
    }, {});
  }, [disciplers]);

  const disciplesById = useMemo(() => {
    return disciples.reduce((acc, disciple) => {
      acc[disciple.id] = disciple;
      return acc;
    }, {});
  }, [disciples]);

  const discipleshipByDiscipler = useMemo(() => {
    return relationships.reduce((acc, relation) => {
      if (!acc[relation.disciplerId]) {
        acc[relation.disciplerId] = [];
      }
      acc[relation.disciplerId].push(relation);
      return acc;
    }, {});
  }, [relationships]);

  const disciplerByDisciple = useMemo(() => {
    return relationships.reduce((acc, relation) => {
      if (!acc[relation.discipleId]) {
        acc[relation.discipleId] = relation;
      }
      return acc;
    }, {});
  }, [relationships]);

  const sortedDisciplers = useMemo(() => {
    return [...disciplers].sort((a, b) => a.name.localeCompare(b.name));
  }, [disciplers]);

  const sortedDisciples = useMemo(() => {
    return [...disciples].sort((a, b) => a.name.localeCompare(b.name));
  }, [disciples]);

  const selectedDiscipler = selectedDisciplerId ? disciplersById[selectedDisciplerId] : null;

  const availableDiscipleOptions = useMemo(() => {
    return sortedDisciples.filter((candidate) => {
      if (!selectedDisciplerId) return false;

      const existingRelation = disciplerByDisciple[candidate.id];
      if (!existingRelation) return true;

      return existingRelation.disciplerId === selectedDisciplerId;
    });
  }, [sortedDisciples, selectedDisciplerId, disciplerByDisciple]);

  const resolveDisciplerName = (disciplerId, relationSample = null) => {
    return (
      disciplersById[disciplerId]?.name ||
      usersById[disciplerId]?.displayName ||
      relationSample?.disciplerName ||
      'Unknown discipler'
    );
  };

  const resolveDiscipleName = (discipleId, relationSample = null) => {
    return (
      disciplesById[discipleId]?.name ||
      usersById[discipleId]?.displayName ||
      relationSample?.discipleName ||
      'Unknown disciple'
    );
  };

  const fetchData = async () => {
    if (!id) return;

    try {
      setLoading(true);

      // Keep legacy users lookup so older relationship docs still show names.
      const usersQuery = query(collection(db, 'users'), where('churchId', '==', id));
      const usersSnapshot = await getDocs(usersQuery);
      const usersData = usersSnapshot.docs.map((userDoc) => {
        const data = userDoc.data();
        const first = data.firstName || data.name || '';
        const last = data.lastName || '';
        const displayName = `${first} ${last}`.trim() || data.email || 'Unnamed member';

        return {
          id: userDoc.id,
          displayName,
          email: data.email || '',
        };
      });

      const disciplersRef = collection(db, 'churches', id, 'disciplers');
      const disciplersSnapshot = await getDocs(disciplersRef);
      const disciplersData = disciplersSnapshot.docs.map((disciplerDoc) => {
        const data = disciplerDoc.data();
        return {
          id: disciplerDoc.id,
          name: data.name || 'Unnamed discipler',
          email: data.email || '',
        };
      });

      const disciplesRef = collection(db, 'churches', id, 'disciples');
      const disciplesSnapshot = await getDocs(disciplesRef);
      const disciplesData = disciplesSnapshot.docs.map((discipleDoc) => {
        const data = discipleDoc.data();
        return {
          id: discipleDoc.id,
          name: data.name || 'Unnamed disciple',
          email: data.email || '',
        };
      });

      const relationsRef = collection(db, 'churches', id, 'discipleshipRelationships');
      const relationsSnapshot = await getDocs(relationsRef);
      const relationsData = relationsSnapshot.docs.map((relationDoc) => ({
        id: relationDoc.id,
        ...relationDoc.data(),
      }));

      setUsers(usersData);
      setDisciplers(disciplersData);
      setDisciples(disciplesData);
      setRelationships(relationsData);
    } catch (error) {
      console.error('Error loading discipleship data:', error);
      toast.error('Failed to load discipleship module data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  useEffect(() => {
    if (!selectedDisciplerId) {
      setSelectedDiscipleIds([]);
      return;
    }

    setSelectedDiscipleIds((prev) =>
      prev.filter((discipleId) => {
        const relation = disciplerByDisciple[discipleId];
        return !relation || relation.disciplerId === selectedDisciplerId;
      })
    );
  }, [selectedDisciplerId, disciplerByDisciple]);

  const handleDiscipleSelection = (event) => {
    const values = Array.from(event.target.selectedOptions, (opt) => opt.value);
    setSelectedDiscipleIds(values);
  };

  const handleAddDiscipler = async (event) => {
    event.preventDefault();

    const name = newDisciplerName.trim();
    const email = newDisciplerEmail.trim();

    if (!name) {
      toast.error('Discipler name is required.');
      return;
    }

    setAddingDiscipler(true);

    try {
      const disciplersRef = collection(db, 'churches', id, 'disciplers');
      await addDoc(disciplersRef, {
        name,
        email,
        churchId: id,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || null,
        createdByEmail: user?.email || '',
      });

      toast.success('Discipler added successfully.');
      setNewDisciplerName('');
      setNewDisciplerEmail('');
      await fetchData();
    } catch (error) {
      console.error('Error adding discipler:', error);
      toast.error('Failed to add discipler.');
    } finally {
      setAddingDiscipler(false);
    }
  };

  const handleAddDisciple = async (event) => {
    event.preventDefault();

    const name = newDiscipleName.trim();
    const email = newDiscipleEmail.trim();

    if (!name) {
      toast.error('Disciple name is required.');
      return;
    }

    setAddingDisciple(true);

    try {
      const disciplesRef = collection(db, 'churches', id, 'disciples');
      await addDoc(disciplesRef, {
        name,
        email,
        churchId: id,
        createdAt: serverTimestamp(),
        createdBy: user?.uid || null,
        createdByEmail: user?.email || '',
      });

      toast.success('Disciple added successfully.');
      setNewDiscipleName('');
      setNewDiscipleEmail('');
      await fetchData();
    } catch (error) {
      console.error('Error adding disciple:', error);
      toast.error('Failed to add disciple.');
    } finally {
      setAddingDisciple(false);
    }
  };

  const handleAssignDisciples = async (event) => {
    event.preventDefault();

    if (!selectedDisciplerId) {
      toast.error('Select a discipler first.');
      return;
    }

    if (selectedDiscipleIds.length === 0) {
      toast.error('Select at least one disciple.');
      return;
    }

    setSaving(true);

    try {
      const relationsRef = collection(db, 'churches', id, 'discipleshipRelationships');
      const blockedNames = [];
      const duplicateNames = [];
      let createdCount = 0;

      for (const discipleId of selectedDiscipleIds) {
        const existingRelation = disciplerByDisciple[discipleId];

        if (existingRelation && existingRelation.disciplerId !== selectedDisciplerId) {
          const discipleName = resolveDiscipleName(discipleId, existingRelation);
          const ownerName = resolveDisciplerName(existingRelation.disciplerId, existingRelation);
          blockedNames.push(`${discipleName} (${ownerName})`);
          continue;
        }

        if (existingRelation && existingRelation.disciplerId === selectedDisciplerId) {
          duplicateNames.push(resolveDiscipleName(discipleId, existingRelation));
          continue;
        }

        await addDoc(relationsRef, {
          disciplerId: selectedDisciplerId,
          disciplerName: selectedDiscipler?.name || '',
          discipleId,
          discipleName: disciplesById[discipleId]?.name || '',
          churchId: id,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || null,
          createdByEmail: user?.email || '',
        });

        createdCount += 1;
      }

      if (createdCount > 0) {
        toast.success(`${createdCount} disciple(s) assigned successfully.`);
      }

      if (blockedNames.length > 0) {
        toast.warning(`Already discipled by someone else: ${blockedNames.join(', ')}`);
      }

      if (duplicateNames.length > 0) {
        toast.info(`Skipped duplicate assignments: ${duplicateNames.join(', ')}`);
      }

      setSelectedDiscipleIds([]);
      await fetchData();
    } catch (error) {
      console.error('Error assigning disciples:', error);
      toast.error('Failed to assign disciples.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveRelation = async (relationId) => {
    const confirmed = window.confirm('Remove this discipleship connection?');
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'churches', id, 'discipleshipRelationships', relationId));
      toast.success('Discipleship connection removed.');
      await fetchData();
    } catch (error) {
      console.error('Error removing relation:', error);
      toast.error('Failed to remove discipleship connection.');
    }
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <h1 style={commonStyles.title}>Loading Discipleship Module...</h1>
      </div>
    );
  }

  return (
    <div style={{ ...commonStyles.fullWidthContainer, padding: '40px 20px' }}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Organization
      </Link>

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ ...commonStyles.title, marginBottom: '8px' }}>Discipleship Map</h1>
        <p style={{ color: '#6B7280', marginTop: 0, marginBottom: '24px' }}>
          Add disciplers and disciples manually, then connect them visually.
        </p>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Add Discipler</h2>
          <form onSubmit={handleAddDiscipler}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <input
                type="text"
                value={newDisciplerName}
                onChange={(e) => setNewDisciplerName(e.target.value)}
                placeholder="Discipler name"
                style={{
                  width: '100%',
                  border: '1px solid #D1D5DB',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '14px',
                }}
              />
              <input
                type="email"
                value={newDisciplerEmail}
                onChange={(e) => setNewDisciplerEmail(e.target.value)}
                placeholder="Discipler email (optional)"
                style={{
                  width: '100%',
                  border: '1px solid #D1D5DB',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '14px',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={addingDiscipler}
              style={{
                marginTop: '12px',
                backgroundColor: '#0EA5E9',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 20px',
                cursor: addingDiscipler ? 'not-allowed' : 'pointer',
                opacity: addingDiscipler ? 0.7 : 1,
                fontWeight: '600',
              }}
            >
              {addingDiscipler ? 'Adding...' : 'Add Discipler'}
            </button>
          </form>
        </div>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Add Disciple</h2>
          <form onSubmit={handleAddDisciple}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <input
                type="text"
                value={newDiscipleName}
                onChange={(e) => setNewDiscipleName(e.target.value)}
                placeholder="Disciple name"
                style={{
                  width: '100%',
                  border: '1px solid #D1D5DB',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '14px',
                }}
              />
              <input
                type="email"
                value={newDiscipleEmail}
                onChange={(e) => setNewDiscipleEmail(e.target.value)}
                placeholder="Disciple email (optional)"
                style={{
                  width: '100%',
                  border: '1px solid #D1D5DB',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '14px',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={addingDisciple}
              style={{
                marginTop: '12px',
                backgroundColor: '#16A34A',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 20px',
                cursor: addingDisciple ? 'not-allowed' : 'pointer',
                opacity: addingDisciple ? 0.7 : 1,
                fontWeight: '600',
              }}
            >
              {addingDisciple ? 'Adding...' : 'Add Disciple'}
            </button>
          </form>
        </div>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Assign Disciples</h2>

          <form onSubmit={handleAssignDisciples}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Discipler
                </label>
                <select
                  value={selectedDisciplerId}
                  onChange={(e) => setSelectedDisciplerId(e.target.value)}
                  style={{
                    width: '100%',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '14px',
                  }}
                >
                  <option value="">Select discipler</option>
                  {sortedDisciplers.map((discipler) => (
                    <option key={discipler.id} value={discipler.id}>
                      {discipler.name}
                      {discipler.email ? ` (${discipler.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                  Disciples (multi-select)
                </label>
                <select
                  multiple
                  value={selectedDiscipleIds}
                  onChange={handleDiscipleSelection}
                  style={{
                    width: '100%',
                    border: '1px solid #D1D5DB',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '14px',
                    minHeight: '180px',
                  }}
                >
                  {availableDiscipleOptions.map((disciple) => {
                    const assigned = disciplerByDisciple[disciple.id];
                    const isAssignedToSelectedDiscipler = assigned?.disciplerId === selectedDisciplerId;
                    const suffix = isAssignedToSelectedDiscipler ? ' - already assigned to this discipler' : '';

                    return (
                      <option key={disciple.id} value={disciple.id}>
                        {disciple.name}
                        {disciple.email ? ` (${disciple.email})` : ''}
                        {suffix}
                      </option>
                    );
                  })}
                </select>
                <p style={{ marginTop: '8px', marginBottom: 0, color: '#6B7280', fontSize: '13px' }}>
                  Hold Ctrl (or Command on Mac) to select multiple disciples.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                marginTop: '16px',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 20px',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
                fontWeight: '600',
              }}
            >
              {saving ? 'Saving...' : 'Assign Selected Disciples'}
            </button>
          </form>
        </div>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Visual Connection Map</h2>

          {Object.keys(discipleshipByDiscipler).length === 0 && (
            <p style={{ margin: 0, color: '#6B7280' }}>
              Add a discipler and connect disciples to see the visual map.
            </p>
          )}

          {Object.entries(discipleshipByDiscipler)
            .sort((a, b) => {
              const nameA = resolveDisciplerName(a[0], a[1][0]);
              const nameB = resolveDisciplerName(b[0], b[1][0]);
              return nameA.localeCompare(nameB);
            })
            .map(([disciplerId, discipleRelations]) => {
              const disciplerName = resolveDisciplerName(disciplerId, discipleRelations[0]);

              return (
                <div
                  key={`visual-${disciplerId}`}
                  style={{
                    borderTop: '1px solid #F3F4F6',
                    paddingTop: '16px',
                    marginTop: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: '#DBEAFE',
                        color: '#1E3A8A',
                        border: '1px solid #BFDBFE',
                        borderRadius: '999px',
                        padding: '8px 14px',
                        fontWeight: '700',
                        fontSize: '14px',
                      }}
                    >
                      {disciplerName}
                    </div>

                    <div
                      style={{
                        color: '#6B7280',
                        fontWeight: '700',
                        fontSize: '16px',
                      }}
                    >
                      ➜
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {discipleRelations.map((relation) => {
                        const discipleName = resolveDiscipleName(relation.discipleId, relation);
                        return (
                          <div
                            key={`chip-${relation.id}`}
                            style={{
                              backgroundColor: '#ECFDF5',
                              color: '#065F46',
                              border: '1px solid #A7F3D0',
                              borderRadius: '999px',
                              padding: '7px 12px',
                              fontWeight: '600',
                              fontSize: '13px',
                            }}
                          >
                            {discipleName}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Who Is Discipling Who</h2>

          {Object.keys(discipleshipByDiscipler).length === 0 && (
            <p style={{ margin: 0, color: '#6B7280' }}>
              No discipleship relationships yet.
            </p>
          )}

          {Object.entries(discipleshipByDiscipler)
            .sort((a, b) => {
              const nameA = resolveDisciplerName(a[0], a[1][0]);
              const nameB = resolveDisciplerName(b[0], b[1][0]);
              return nameA.localeCompare(nameB);
            })
            .map(([disciplerId, discipleRelations]) => {
              const disciplerName = resolveDisciplerName(disciplerId, discipleRelations[0]);

              return (
                <div
                  key={disciplerId}
                  style={{
                    borderTop: '1px solid #F3F4F6',
                    paddingTop: '16px',
                    marginTop: '16px',
                  }}
                >
                  <h3 style={{ margin: '0 0 8px 0' }}>
                    {disciplerName} ({discipleRelations.length})
                  </h3>

                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {discipleRelations.map((relation) => {
                      const discipleName = resolveDiscipleName(relation.discipleId, relation);

                      return (
                        <li
                          key={relation.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '8px',
                          }}
                        >
                          <span>{discipleName}</span>
                          <button
                            onClick={() => handleRemoveRelation(relation.id)}
                            style={{
                              backgroundColor: '#FEE2E2',
                              color: '#B91C1C',
                              border: '1px solid #FECACA',
                              borderRadius: '6px',
                              padding: '6px 10px',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default DiscipleshipPage;
