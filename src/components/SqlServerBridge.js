import React, { useState, useEffect } from 'react';
import ChurchHeader from './ChurchHeader';

const SqlServerBridge = () => {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [tableData, setTableData] = useState([]);
  const [tableSchema, setTableSchema] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [customQuery, setCustomQuery] = useState('');
  const [queryResult, setQueryResult] = useState(null);
  const [databaseOverview, setDatabaseOverview] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // Load database overview on component mount
  useEffect(() => {
    loadDatabaseOverview();
  }, []);

  const loadDatabaseOverview = async () => {
    setLoading(true);
    try {
      const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/getDatabaseOverview');
      const data = await response.json();

      if (data.success) {
        setDatabaseOverview(data);
        setTables(data.tables || []);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to load database overview: ' + err.message);
    }
    setLoading(false);
  };

  const loadTableData = async (tableName, schema = 'dbo', page = 1) => {
    setLoading(true);
    setSelectedTable(tableName);
    try {
      // Load schema first
      const schemaResponse = await fetch(
        `https://us-central1-igletechv1.cloudfunctions.net/getTableSchema?tableName=${tableName}&schema=${schema}`
      );
      const schemaData = await schemaResponse.json();

      if (schemaData.success) {
        setTableSchema(schemaData.columns || []);
      }

      // Load data
      const dataResponse = await fetch(
        `https://us-central1-igletechv1.cloudfunctions.net/getTableData?tableName=${tableName}&schema=${schema}&page=${page}&limit=${pageSize}`
      );
      const dataResult = await dataResponse.json();

      if (dataResult.success) {
        setTableData(dataResult.data || []);
        setCurrentPage(page);
      } else {
        setError(dataResult.error);
      }
    } catch (err) {
      setError('Failed to load table data: ' + err.message);
    }
    setLoading(false);
  };

  const executeCustomQuery = async () => {
    if (!customQuery.trim()) return;

    setLoading(true);
    try {
      const response = await fetch('https://us-central1-igletechv1.cloudfunctions.net/executeSqlQuery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: customQuery,
          params: []
        })
      });

      const data = await response.json();

      if (data.success) {
        setQueryResult(data);
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to execute query: ' + err.message);
    }
    setLoading(false);
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div>
      <ChurchHeader />
      <div style={{ maxWidth: '1400px', margin: '2rem auto', padding: '0 1rem' }}>
        <h1 style={{ marginBottom: '2rem', color: '#1f2937' }}>SQL Server Database Bridge</h1>

        {error && (
          <div style={{
            background: '#fee2e2',
            color: '#dc2626',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            border: '1px solid #fecaca'
          }}>
            <strong>Error:</strong> {error}
            <button
              onClick={() => setError(null)}
              style={{
                float: 'right',
                background: 'none',
                border: 'none',
                color: '#dc2626',
                cursor: 'pointer',
                fontSize: '1.2rem'
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Database Overview */}
        {databaseOverview && (
          <div style={{
            background: '#f8fafc',
            padding: '1.5rem',
            borderRadius: '12px',
            marginBottom: '2rem',
            border: '1px solid #e2e8f0'
          }}>
            <h2 style={{ marginBottom: '1rem', color: '#1f2937' }}>Database Overview</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong>Database:</strong> {databaseOverview.database?.database_name}
              </div>
              <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong>Total Tables:</strong> {databaseOverview.totalTables}
              </div>
              <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong>Total Records:</strong> {databaseOverview.totalRecords?.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* Tables List */}
          <div style={{
            background: '#f8fafc',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}>
            <h2 style={{ marginBottom: '1rem', color: '#1f2937' }}>Tables</h2>
            <div style={{
              maxHeight: '600px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '8px'
            }}>
              {tables.map((table, index) => (
                <div
                  key={index}
                  onClick={() => loadTableData(table.TABLE_NAME, table.TABLE_SCHEMA)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: index < tables.length - 1 ? '1px solid #e2e8f0' : 'none',
                    cursor: 'pointer',
                    background: selectedTable === table.TABLE_NAME ? '#e0f2fe' : 'transparent',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedTable !== table.TABLE_NAME) {
                      e.target.style.background = '#f1f5f9';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedTable !== table.TABLE_NAME) {
                      e.target.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ fontWeight: '500', color: '#1f2937' }}>
                    {table.TABLE_SCHEMA}.{table.TABLE_NAME}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    {table.row_count?.toLocaleString() || 0} records
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table Data */}
          <div style={{
            background: '#f8fafc',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}>
            {selectedTable ? (
              <>
                <h2 style={{ marginBottom: '1rem', color: '#1f2937' }}>
                  {selectedTable} Data
                </h2>

                {tableSchema.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1rem', color: '#374151', marginBottom: '0.5rem' }}>
                      Schema ({tableSchema.length} columns)
                    </h3>
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      marginBottom: '1rem'
                    }}>
                      {tableSchema.slice(0, 10).map((col, index) => (
                        <span
                          key={index}
                          style={{
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '500'
                          }}
                        >
                          {col.COLUMN_NAME} ({col.DATA_TYPE})
                        </span>
                      ))}
                      {tableSchema.length > 10 && (
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          +{tableSchema.length - 10} more...
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {loading ? (
                  <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <div>Loading...</div>
                  </div>
                ) : (
                  <div style={{
                    maxHeight: '500px',
                    overflow: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}>
                    {tableData.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f1f5f9' }}>
                            {tableSchema.slice(0, 8).map((col, index) => (
                              <th
                                key={index}
                                style={{
                                  padding: '0.75rem',
                                  textAlign: 'left',
                                  fontWeight: '600',
                                  color: '#374151',
                                  borderBottom: '1px solid #e2e8f0',
                                  fontSize: '0.875rem'
                                }}
                              >
                                {col.COLUMN_NAME}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.map((row, rowIndex) => (
                            <tr key={rowIndex} style={{
                              background: rowIndex % 2 === 0 ? '#fff' : '#f8fafc',
                              borderBottom: '1px solid #f1f5f9'
                            }}>
                              {tableSchema.slice(0, 8).map((col, colIndex) => (
                                <td
                                  key={colIndex}
                                  style={{
                                    padding: '0.75rem',
                                    fontSize: '0.875rem',
                                    color: '#374151',
                                    maxWidth: '200px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                  title={formatValue(row[col.COLUMN_NAME])}
                                >
                                  {formatValue(row[col.COLUMN_NAME])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No data found in this table
                      </div>
                    )}
                  </div>
                )}

                {tableData.length > 0 && (
                  <div style={{
                    marginTop: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                      Showing {tableData.length} records
                    </div>
                    <div>
                      <button
                        onClick={() => loadTableData(selectedTable, 'dbo', currentPage - 1)}
                        disabled={currentPage === 1 || loading}
                        style={{
                          padding: '0.5rem 1rem',
                          marginRight: '0.5rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          background: '#fff',
                          cursor: currentPage === 1 || loading ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => loadTableData(selectedTable, 'dbo', currentPage + 1)}
                        disabled={tableData.length < pageSize || loading}
                        style={{
                          padding: '0.5rem 1rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          background: '#fff',
                          cursor: tableData.length < pageSize || loading ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                <h3>Select a table to view its data</h3>
                <p>Click on any table from the list to see its contents</p>
              </div>
            )}
          </div>
        </div>

        {/* Custom Query Section */}
        <div style={{
          background: '#f8fafc',
          padding: '1.5rem',
          borderRadius: '12px',
          marginTop: '2rem',
          border: '1px solid #e2e8f0'
        }}>
          <h2 style={{ marginBottom: '1rem', color: '#1f2937' }}>Custom SQL Query</h2>
          <div style={{ marginBottom: '1rem' }}>
            <textarea
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder="Enter SELECT query (READ-ONLY for security)"
              style={{
                width: '100%',
                minHeight: '100px',
                padding: '0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <button
            onClick={executeCustomQuery}
            disabled={loading || !customQuery.trim()}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              cursor: loading || !customQuery.trim() ? 'not-allowed' : 'pointer',
              fontWeight: '500'
            }}
          >
            {loading ? 'Executing...' : 'Execute Query'}
          </button>

          {queryResult && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ color: '#1f2937', marginBottom: '0.5rem' }}>
                Query Results ({queryResult.rowCount} rows)
              </h3>
              <div style={{
                maxHeight: '300px',
                overflow: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: '8px'
              }}>
                <pre style={{
                  margin: 0,
                  padding: '1rem',
                  background: '#f8fafc',
                  fontSize: '0.75rem',
                  overflow: 'auto'
                }}>
                  {JSON.stringify(queryResult.result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SqlServerBridge;
