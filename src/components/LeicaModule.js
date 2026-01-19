import React, { useState, useRef, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label, Brush } from "recharts";
import { ScatterChart, Scatter, ZAxis, Customized } from "recharts";
import { Polyline } from 'recharts'; // Not a real recharts export, so use a custom SVG <polyline> below
import { saveLeicaProjectConfig, loadLeicaProjectConfig } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// Dynamic, highly distinct color generator using golden angle in HSL
function getDistinctColor(index, total = 24, sat = 70, light = 50) {
  // Golden angle in degrees
  const goldenAngle = 137.508;
  // Spread hues using golden angle
  const hue = (index * goldenAngle) % 360;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// Generate visually distinct colors for any index (for codes/weeks)
// function getDistinctColor(idx, total) {
//   // Use golden angle to maximize hue separation
//   const goldenAngle = 137.508;
//   const hue = (idx * goldenAngle) % 360;
//   // For large sets, alternate lightness for more distinction
//   const lightness = total > 20 ? (idx % 2 === 0 ? 52 : 38) : 45;
//   const saturation = 70;
//   return `hsl(${hue},${saturation}%,${lightness}%)`;
// }

const parseCSV = (text) => {
  // Use PapaParse for robust CSV parsing
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  return result.data;
};

const filterRows = (rows, keyword) => {
  if (!keyword) return rows;
  const lower = keyword.toLowerCase();
  return rows.filter(row =>
    Object.values(row).some(val =>
      String(val || "").toLowerCase().includes(lower)
    )
  );
};

const getProfileData = (rows) => {
  // Try to find the right column names (case-insensitive)
  if (!rows || rows.length === 0) return [];
  const sample = rows[0];
  const keys = Object.keys(sample).reduce((acc, k) => {
    const lower = k.toLowerCase();
    if (lower.includes("north")) acc.northing = k;
    if (lower.includes("east")) acc.easting = k;
    if (lower.includes("elev")) acc.elevation = k;
    return acc;
  }, { northing: null, easting: null, elevation: null });
  if (!keys.northing || !keys.easting || !keys.elevation) return [];
  // Sort by northing or easting for profile
  const sorted = [...rows].sort((a, b) => {
    const aN = parseFloat(a[keys.northing]);
    const bN = parseFloat(b[keys.northing]);
    if (!isNaN(aN) && !isNaN(bN)) return aN - bN;
    const aE = parseFloat(a[keys.easting]);
    const bE = parseFloat(b[keys.easting]);
    if (!isNaN(aE) && !isNaN(bE)) return aE - bE;
    return 0;
  });
  return sorted.map(row => ({
    northing: parseFloat(row[keys.northing]),
    easting: parseFloat(row[keys.easting]),
    elevation: parseFloat(row[keys.elevation]),
  })).filter(d => !isNaN(d.northing) && !isNaN(d.easting) && !isNaN(d.elevation));
};

const LeicaModule = () => {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [xCol, setXCol] = useState("");
  const [yCol, setYCol] = useState("");
  const [zCol, setZCol] = useState("");
  const [idCol, setIdCol] = useState("");
  const [dateCol, setDateCol] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(null);
  const [brushStartIndex, setBrushStartIndex] = useState(null);
  const [brushEndIndex, setBrushEndIndex] = useState(null);
  const [codeCol, setCodeCol] = useState("");
  const [codeValues, setCodeValues] = useState([]);
  const [visibleCodes, setVisibleCodes] = useState([]);
  const [brushDomain, setBrushDomain] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [projectList, setProjectList] = useState([]);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [projectError, setProjectError] = useState('');
  const rowRefs = useRef([]);
  const chartContainerRef = useRef(null);
  // Add a ref to track if a project is being loaded
  const projectLoadRef = useRef(false);

  // Scroll to selected row when it changes (only for table row clicks, not chart clicks)
  useEffect(() => {
    if (selectedRowIndex !== null && rowRefs.current[selectedRowIndex] && scrollOnRowClick) {
      rowRefs.current[selectedRowIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedRowIndex]);

  const handleFile = (e) => {
    setError("");
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      let text = evt.target.result;
      let data;
      try {
        // Use PapaParse for robust parsing (handles CSV, tab, and space delimited)
        const result = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter: "", dynamicTyping: false });
        data = result.data;
        setRows(data);
        setColumns(data.length > 0 ? Object.keys(data[0]) : []);
        // Default: A=id, B=x, C=y, D=z
        if (data.length > 0) {
          const keys = Object.keys(data[0]);
          setIdCol(keys[0] || "");
          setXCol(keys[1] || "");
          setYCol(keys[2] || "");
          setZCol(keys[3] || "");
          setDateCol(keys[keys.length - 1] || "");
        }
      } catch (err) {
        setError("Failed to parse file. Please check the format.");
      }
    };
    reader.readAsText(file);
  };

  // Helper to filter by date range
  const filterByDateRange = (rows) => {
    if (!startDate && !endDate) return rows;
    if (!dateCol) return rows;
    return rows.filter(row => {
      const rowDate = row[dateCol];
      if (!rowDate) return false;
      const rowTime = new Date(rowDate).getTime();
      const startTime = startDate ? new Date(startDate).getTime() : -Infinity;
      const endTime = endDate ? new Date(endDate).getTime() : Infinity;
      return rowTime >= startTime && rowTime <= endTime;
    });
  };

  // Apply date filter after keyword filter
  const filteredRows = filterByDateRange(filterRows(rows, keyword));

  // Build scatter data for (x, y, z) points
  const scatterData = (filteredRows && xCol && yCol && zCol)
    ? filteredRows
        .map(row => ({
          id: row[idCol],
          x: parseFloat(row[xCol]),
          y: parseFloat(row[yCol]),
          z: parseFloat(row[zCol]),
        }))
        .filter(d => !isNaN(d.x) && !isNaN(d.y) && !isNaN(d.z))
    : [];

  // Find Z min/max for color scale
  const zMin = scatterData.length > 0 ? Math.min(...scatterData.map(d => d.z)) : 0;
  const zMax = scatterData.length > 0 ? Math.max(...scatterData.map(d => d.z)) : 1;

  // Assign a color to each week (using getDistinctColor)
  const weekColors = useMemo(() => {
    const weekKeys = Array.from(new Set(filteredRows.map(row => getWeekKey(row[dateCol])).filter(Boolean)));
    const colors = {};
    weekKeys.forEach((weekKey, i) => {
      colors[weekKey] = getDistinctColor(i, weekKeys.length, 70, 50);
    });
    return colors;
  }, [filteredRows, dateCol]);

  // Memoized chart data with weekKey, weekColor, rowIndex
  const chartData = useMemo(() => {
    if (!(filteredRows && idCol && zCol && xCol)) return [];
    return filteredRows.map((row, i) => {
      const weekKey = getWeekKey(row[dateCol]);
      const codeLineValues = {};
      if (codeCol && codeValues.length) {
        codeValues.forEach(code => {
          codeLineValues[`code_${code}`] = row[codeCol] === code ? parseFloat(row[zCol]) : null;
        });
      }
      return {
        id: row[idCol],
        x: parseFloat(row[xCol]),
        y: parseFloat(row[zCol]),
        xRaw: row[xCol],
        yRaw: row[yCol],
        zRaw: row[zCol],
        weekKey,
        weekColor: weekColors[weekKey] || '#888',
        ...row,
        rowIndex: i,
        ...codeLineValues
      };
    }).filter(d => d.id !== undefined && d.id !== "" && !isNaN(d.y) && !isNaN(d.x));
  }, [filteredRows, idCol, zCol, xCol, yCol, dateCol, weekColors, codeCol, codeValues]);

  // Compute filtered chart data for visible (zoomed) range
  const visibleChartData = useMemo(() => {
    if (!brushDomain || !xCol) return chartData;
    return chartData.filter(d => d.x >= brushDomain[0] && d.x <= brushDomain[1]);
  }, [chartData, brushDomain, xCol]);

  // Compute visible points for polyline (sorted by x)
  const visiblePolylinePoints = useMemo(() => {
    if (!visibleChartData || visibleChartData.length === 0) return '';
    // Sort by x (or id if you want a specific order)
    const sorted = [...visibleChartData].sort((a, b) => a.x - b.x);
    return sorted.map(d => `${d.x},${d.y}`).join(' ');
  }, [visibleChartData]);

  // Show the first row (headers) as a preview
  const selectedRow = selectedRowId ? filteredRows.find(r => r[idCol] === selectedRowId) : null;
  const headerPreview = columns.length > 0 ? (
    <div style={{ marginBottom: 12, background: '#f3f4f6', borderRadius: 6, padding: 10, fontSize: 15, color: '#1e293b' }}>
      <strong>Columns:</strong> {columns.join(' | ')}
      {selectedRow && (
        <div style={{ marginTop: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, padding: 8, fontSize: 14, color: '#334155' }}>
          <strong>Selected Point Data:</strong>
          <table style={{ marginTop: 4 }}>
            <tbody>
              {columns.map(col => (
                <tr key={col}>
                  <td style={{ fontWeight: 600, paddingRight: 8 }}>{col}:</td>
                  <td>{selectedRow[col]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  ) : null;

  // Helper to get week number (Monday-Sunday)
  function getWeekKey(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    // Set to Monday
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
    const monday = new Date(d.setDate(diff));
    // Format as YYYY-WW
    const year = monday.getFullYear();
    const week = Math.ceil((((monday - new Date(monday.getFullYear(),0,1)) / 86400000) + monday.getDay()+1)/7);
    return `${year}-W${week.toString().padStart(2,'0')}`;
  }

  // Helper to get week start and end dates (Monday-Sunday)
  function getWeekRange(weekKey) {
    // weekKey is in format YYYY-Wxx
    const [year, weekStr] = weekKey.split('-W');
    const week = parseInt(weekStr, 10);
    // Find the first Monday of the year
    const firstDay = new Date(Number(year), 0, 1);
    const firstMonday = new Date(firstDay);
    const day = firstDay.getDay();
    let dayOffset = 1 - day; // Monday is 1
    if (day === 0) dayOffset = 1; // If Jan 1 is Sunday, next day is Monday
    firstMonday.setDate(firstDay.getDate() + dayOffset);
    // Calculate start and end of the week
    const start = new Date(firstMonday);
    start.setDate(firstMonday.getDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    // Format as MM-DD-YYYY
    const fmt = d => `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${d.getFullYear()}`;
    return `${fmt(start)} to ${fmt(end)}`;
  }

  // Add a state to control scroll behavior
  const [scrollOnRowClick, setScrollOnRowClick] = useState(false);

  // When a row is clicked, zoom to that point in the chart and scroll to row
  const handleRowClick = (rowIndex) => {
    setSelectedRowIndex(rowIndex);
    setScrollOnRowClick(true);
    // Zoom to +/- 10 points around the selected point
    const windowSize = 20;
    const start = Math.max(0, rowIndex - Math.floor(windowSize / 2));
    const end = Math.min(chartData.length - 1, start + windowSize - 1);
    setBrushStartIndex(start);
    setBrushEndIndex(end);
  };

  // When a chart point is clicked, just highlight the row (do not scroll)
  const handleChartClick = (e) => {
    if (e && e.activePayload && e.activePayload[0]) {
      const rowIndex = e.activePayload[0].payload.rowIndex;
      if (rowIndex !== undefined && rowIndex !== null) {
        setScrollOnRowClick(false);
        setSelectedRowIndex(rowIndex);
      }
    }
  };

  // Mouse wheel zoom/pan for chart (only with Shift)
  useEffect(() => {
    const handleWheel = (e) => {
      if (!chartData.length) return;
      // Only zoom/pan if mouse is over the chart and Shift is held
      if (!chartContainerRef.current || !chartContainerRef.current.contains(e.target) || !e.shiftKey) return;
      e.preventDefault();
      const windowSize = (brushEndIndex !== null && brushStartIndex !== null)
        ? brushEndIndex - brushStartIndex + 1
        : Math.min(20, chartData.length);
      let start = brushStartIndex !== null ? brushStartIndex : 0;
      let end = brushEndIndex !== null ? brushEndIndex : Math.max(chartData.length - 1, 0);
      // Zoom in/out
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Zoom: ctrl+wheel or alt+wheel
        if (e.deltaY < 0 && windowSize > 2) {
          // Zoom in
          start += 1;
          end -= 1;
        } else if (e.deltaY > 0 && windowSize < chartData.length) {
          // Zoom out
          start = Math.max(0, start - 1);
          end = Math.min(chartData.length - 1, end + 1);
        }
      } else {
        // Pan: wheel up/down
        const panStep = Math.max(1, Math.floor(windowSize / 5));
        if (e.deltaY > 0) {
          // Pan right
          if (end < chartData.length - 1) {
            start = Math.min(chartData.length - windowSize, start + panStep);
            end = start + windowSize - 1;
          }
        } else if (e.deltaY < 0) {
          // Pan left
          if (start > 0) {
            start = Math.max(0, start - panStep);
            end = start + windowSize - 1;
          }
        }
      }
      // Clamp
      start = Math.max(0, Math.min(start, chartData.length - 2));
      end = Math.max(start + 1, Math.min(end, chartData.length - 1));
      setBrushStartIndex(start);
      setBrushEndIndex(end);
    };
    const ref = chartContainerRef.current;
    if (ref) {
      ref.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (ref) ref.removeEventListener('wheel', handleWheel);
    };
  }, [chartData.length, brushStartIndex, brushEndIndex]);

  // When codeCol changes, update codeValues
  useEffect(() => {
    if (!codeCol || !filteredRows.length) {
      setCodeValues([]);
      return;
    }
    // Get unique codes in the selected code column
    const codes = Array.from(new Set(filteredRows.map(row => row[codeCol]).filter(Boolean)));
    setCodeValues(codes);
  }, [codeCol, filteredRows]);

  // When codeCol or codeValues change, reset visibleCodes to all codes unless loading a project
  useEffect(() => {
    if (projectLoadRef.current) {
      setVisibleCodes(projectLoadRef.current);
      projectLoadRef.current = null;
    } else if (codeCol && codeValues.length) {
      setVisibleCodes(codeValues);
    } else {
      setVisibleCodes([]);
    }
  }, [codeCol, codeValues]);

  // Pagination state
  const [page, setPage] = useState(1);
  const rowsPerPage = 20;
  const totalPages = Math.ceil(filteredRows.length / rowsPerPage);
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredRows.slice(start, start + rowsPerPage);
  }, [filteredRows, page]);

  // Reset to page 1 on filter/file change
  useEffect(() => { setPage(1); }, [filteredRows, rows.length]);

  // Fetch project list on mount
  useEffect(() => {
    async function fetchProjects() {
      try {
        const snap = await getDocs(collection(db, 'leicaProjects'));
        setProjectList(snap.docs.map(doc => doc.id));
      } catch (e) {
        setProjectList([]);
      }
    }
    fetchProjects();
  }, []);

  // Save project config
  const handleSaveProject = async () => {
    setProjectError('');
    if (!projectName) { setProjectError('Project name required'); return; }
    setIsSavingProject(true);
    try {
      await saveLeicaProjectConfig(projectName, {
        idCol, xCol, yCol, zCol, dateCol, codeCol,
        visibleCodes, // ensure this is saved
        columns,
        saved: new Date().toISOString(),
      });
      setProjectError('Saved!');
      // Refresh project list
      const snap = await getDocs(collection(db, 'leicaProjects'));
      setProjectList(snap.docs.map(doc => doc.id));
    } catch (e) {
      setProjectError('Save failed: ' + e.message);
    }
    setIsSavingProject(false);
  };

  // Load project config
  const handleLoadProject = async (name) => {
    setProjectError('');
    setIsLoadingProject(true);
    try {
      const config = await loadLeicaProjectConfig(name || projectName);
      if (!config) { setProjectError('Project not found'); setIsLoadingProject(false); return; }
      setIdCol(config.idCol || '');
      setXCol(config.xCol || '');
      setYCol(config.yCol || '');
      setZCol(config.zCol || '');
      setDateCol(config.dateCol || '');
      setCodeCol(config.codeCol || '');
      // Set a ref to indicate a project is being loaded
      projectLoadRef.current = config.visibleCodes || [];
      setProjectName(name || projectName);
      setProjectError('Loaded!');
    } catch (e) {
      setProjectError('Load failed: ' + e.message);
    }
    setIsLoadingProject(false);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>Leica File Analyzer</h1>
      <input
        type="file"
        accept=".csv,.txt"
        onChange={handleFile}
        style={{ marginBottom: 16 }}
      />
      {headerPreview}
      {error && <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>}
      {columns.length > 1 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            ID:
            <select value={idCol} onChange={e => setIdCol(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            X Axis:
            <select value={xCol} onChange={e => setXCol(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            Y Axis:
            <select value={yCol} onChange={e => setYCol(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            Elevation (Z):
            <select value={zCol} onChange={e => setZCol(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            Date:
            <select value={dateCol} onChange={e => setDateCol(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            Code Column:
            <select value={codeCol} onChange={e => setCodeCol(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }}>
              <option value="">Select column</option>
              {columns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </label>
          <label>
            Start Date:
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ marginLeft: 8, marginRight: 24 }} />
          </label>
          <label>
            End Date:
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ marginLeft: 8 }} />
          </label>
        </div>
      )}
      {chartData.length > 0 && (
        <div ref={chartContainerRef} style={{ marginBottom: 32, background: "#f8fafc", borderRadius: 8, padding: 16, boxShadow: "0 2px 8px #0001" }}>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>Plan View ({xCol} (X) vs. {yCol} (Y), color/size by {zCol} (Elevation))</h2>
          {/* Week color legend */}
          {dateCol && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: '#334155', marginRight: 8 }}>Week Legend:</span>
              {Object.keys(weekColors).sort().map(weekKey => (
                <span key={weekKey} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: weekColors[weekKey], display: 'inline-block', border: '1.5px solid #fff', boxShadow: '0 0 0 1px #ccc', marginRight: 3 }} />
                  <span style={{ color: '#334155', fontWeight: 500 }}>{weekKey}</span>
                  <span style={{ color: '#64748b', fontSize: 13, marginLeft: 2 }}>({getWeekRange(weekKey)})</span>
                </span>
              ))}
            </div>
          )}
          <ResponsiveContainer width="100%" height={500}>
            <ScatterChart
              margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
              onClick={handleChartClick}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="x"
                name={xCol}
                type="number"
                domain={[dataMin => Math.floor(dataMin), dataMax => Math.ceil(dataMax)]}
                label={{ value: xCol, position: 'insideBottom', offset: -10 }}
              />
              <YAxis
                dataKey="y"
                name={yCol}
                type="number"
                domain={[dataMin => Math.floor(dataMin), dataMax => Math.ceil(dataMax)]}
                label={{ value: yCol, angle: -90, position: 'insideLeft' }}
              />
              <ZAxis dataKey="zRaw" range={[100, 400]} name={zCol} />
              {/* Area highlight between code lines for each week */}
              <Customized
                component={({ xAxisMap, yAxisMap }) => {
                  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
                  const yAxis = yAxisMap[Object.keys(yAxisMap)[0]];
                  if (!xAxis || !yAxis) return null;
                  // Group visibleChartData by weekKey
                  const weekSegments = Object.keys(weekColors).map(weekKey => ({
                    weekKey,
                    color: weekColors[weekKey],
                  }));
                  return (
                    <>
                      <AreaBetweenWeeks
                        weekSegments={weekSegments}
                        xAxis={xAxis}
                        yAxis={yAxis}
                        codeCol={codeCol}
                        codeValues={codeValues}
                        visibleCodes={visibleCodes}
                        visibleChartData={visibleChartData}
                      />
                      {/* Draw a polyline for each code and week, using week color */}
                      {codeCol && codeValues.length > 0 && visibleCodes.length > 0 &&
                        weekSegments.flatMap(({ weekKey, color }) => (
                          visibleCodes.map(code => {
                            const codePoints = visibleChartData
                              .filter(d => d[codeCol] === code && d.weekKey === weekKey)
                              .sort((a, b) => a.x - b.x)
                              .map(d => ({ x: xAxis.scale(d.x), y: yAxis.scale(d.y) }));
                            if (codePoints.length < 2) return null;
                            return (
                              <PolylineConnector
                                key={`polyline-${weekKey}-${code}`}
                                points={codePoints}
                                color={color} // Use week color for the line
                              />
                            );
                          })
                        ))
                      }
                    </>
                  );
                }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const p = payload[0].payload;
                  const info = [];
                  if (p.id) info.push(<div key="id"><b>Point ID:</b> {p.id}</div>);
                  if (xCol && p.xRaw !== undefined) info.push(<div key="x"><b>{xCol} (X):</b> {p.xRaw}</div>);
                  if (yCol && p.yRaw !== undefined) info.push(<div key="y"><b>{yCol} (Y):</b> {p.yRaw}</div>);
                  if (zCol && p.zRaw !== undefined) info.push(<div key="z"><b>{zCol} (Elevation):</b> {p.zRaw}</div>);
                  if (dateCol && p[dateCol] !== undefined) {
                    const rawDate = p[dateCol];
                    let formattedDate = rawDate;
                    if (rawDate) {
                      const d = new Date(rawDate);
                      if (!isNaN(d.getTime())) {
                        formattedDate = `${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}-${d.getFullYear()}`;
                      }
                    }
                    info.push(<div key="date"><b>{dateCol} (Date):</b> {formattedDate}</div>);
                  }
                  if (p.weekKey) info.push(<div key="week"><b>Week:</b> {p.weekKey}</div>);
                  columns.forEach(col => {
                    if (![idCol, xCol, yCol, zCol, dateCol].includes(col)) {
                      if (p[col] !== undefined && p[col] !== "") {
                        info.push(<div key={col}><b>{col}:</b> {p[col]}</div>);
                      }
                    }
                  });
                  return <div style={{ background: '#fff', border: '1px solid #ccc', padding: 8, borderRadius: 4 }}>{info}</div>;
                }}
              />
              <Legend
                content={({ payload }) => (
                  <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 16, listStyle: 'none', margin: 0, padding: 0 }}>
                    {payload && payload.map(entry => {
                      const isActive = visibleCodes.includes(entry.id);
                      // Use getDistinctColor for code color
                      const codeIdx = codeValues.indexOf(entry.id);
                      const codeColor = getDistinctColor(codeIdx, codeValues.length, 70, 45);
                      return (
                        <li
                          key={entry.id}
                          onClick={() => {
                            setVisibleCodes(prev =>
                              prev.includes(entry.id)
                                ? prev.filter(c => c !== entry.id)
                                : [...prev, entry.id]
                            );
                          }}
                          style={{
                            cursor: 'pointer',
                            color: codeColor,
                            textDecoration: isActive ? 'none' : 'line-through',
                            opacity: isActive ? 1 : 0.5,
                            fontWeight: isActive ? 600 : 400,
                            fontSize: 16,
                            userSelect: 'none',
                            transition: 'opacity 0.2s, text-decoration 0.2s',
                          }}
                          title={isActive ? `Hide ${entry.value}` : `Show ${entry.value}`}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: codeColor,
                            marginRight: 8,
                            border: '2px solid #fff',
                            verticalAlign: 'middle',
                            boxShadow: '0 0 0 1px #ccc',
                            opacity: isActive ? 1 : 0.5,
                          }} />
                          <span>{entry.value}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                payload={codeCol && codeValues.length > 0 ? codeValues.map((code, i) => ({
                  value: code,
                  type: 'circle',
                  color: getDistinctColor(i, codeValues.length, 70, 45),
                  id: code
                })) : []}
                wrapperStyle={{ cursor: 'pointer', marginBottom: 8 }}
              />
              {codeCol && codeValues.length > 0 ? (
                visibleCodes.map((code, i) => (
                  <Scatter
                    key={`code_${code}`}
                    name={code}
                    data={visibleChartData.filter(d => d[codeCol] === code)}
                    fill={getDistinctColor(i, codeValues.length, 70, 45)}
                    shape={props => {
                      const { cx, cy, payload } = props;
                      const isSelected = selectedRowIndex !== null && payload.rowIndex === selectedRowIndex;
                      return (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 10 : 6}
                          fill={isSelected ? '#f59e42' : getDistinctColor(i, codeValues.length, 70, 45)}
                          stroke={isSelected ? '#b91c1c' : '#fff'}
                          strokeWidth={isSelected ? 3 : 1}
                          style={{ cursor: 'pointer' }}
                        />
                      );
                    }}
                  />
                ))
              ) : (
                <Scatter
                  name={zCol}
                  data={visibleChartData}
                  fill="#1e40af"
                  shape={props => {
                    const { cx, cy, payload } = props;
                    const isSelected = selectedRowIndex !== null && payload.rowIndex === selectedRowIndex;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 10 : 6}
                        fill={isSelected ? '#f59e42' : payload.weekColor}
                        stroke={isSelected ? '#b91c1c' : '#fff'}
                        strokeWidth={isSelected ? 3 : 1}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  }}
                />
              )}
              <Brush
                dataKey="x"
                height={24}
                stroke="#8884d8"
                travellerWidth={10}
                startIndex={0}
                endIndex={chartData.length - 1}
                onChange={({ startIndex, endIndex }) => {
                  if (startIndex == null || endIndex == null) {
                    setBrushDomain(null);
                    return;
                  }
                  // Get the x values at the start/end indices
                  const sorted = [...chartData].sort((a, b) => a.x - b.x);
                  const minX = sorted[startIndex]?.x;
                  const maxX = sorted[endIndex]?.x;
                  setBrushDomain([minX, maxX]);
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <input
            type="text"
            placeholder="Search by keyword..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            style={{ marginBottom: 16, padding: 8, width: 300, borderRadius: 4, border: "1px solid #ccc" }}
          />
          <div style={{ width: "100%" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {/* Add a Week column if dateCol is set */}
                  {dateCol && <th style={{ border: "1px solid #e5e7eb", padding: 8, background: "#f3f4f6" }}>Week</th>}
                  {columns.map(col => (
                    <th key={col} style={{ border: "1px solid #e5e7eb", padding: 8, background: "#f3f4f6" }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row, i) => {
                  const globalIdx = (page - 1) * rowsPerPage + i;
                  const weekKey = getWeekKey(row[dateCol]);
                  return (
                    <tr
                      key={globalIdx}
                      ref={el => rowRefs.current[globalIdx] = el}
                      style={{
                        border: "1px solid #e5e7eb",
                        background: globalIdx === selectedRowIndex ? '#fde68a' : undefined,
                        transition: 'background 0.3s',
                        cursor: 'pointer',
                        borderLeft: dateCol ? `8px solid ${weekColors[weekKey] || '#888'}` : undefined,
                      }}
                      onClick={() => handleRowClick(globalIdx)}
                    >
                      {/* Week color dot and weekKey */}
                      {dateCol && (
                        <td style={{ border: "1px solid #e5e7eb", padding: 8, textAlign: 'center' }}>
                          <span style={{ width: 12, height: 12, borderRadius: '50%', background: weekColors[weekKey] || '#888', display: 'inline-block', marginRight: 4, border: '1.5px solid #fff', boxShadow: '0 0 0 1px #ccc', verticalAlign: 'middle' }} />
                          <span style={{ fontSize: 13, color: '#334155' }}>{weekKey}</span>
                        </td>
                      )}
                      {columns.map(col => (
                        <td key={col} style={{ border: "1px solid #e5e7eb", padding: 8 }}>{row[col]}</td>
                      ))}
                    </tr>
                  );
                })}
                {paginatedRows.length === 0 && (
                  <tr><td colSpan={columns.length} style={{ textAlign: "center", color: "#888" }}>No results</td></tr>
                )}
              </tbody>
            </table>
            {/* Pagination controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', background: page === 1 ? '#f1f5f9' : '#fff', cursor: page === 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pn => (
                  <button
                    key={pn}
                    onClick={() => setPage(pn)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: '1px solid #ccc',
                      background: pn === page ? '#2563eb' : '#fff',
                      color: pn === page ? '#fff' : '#222',
                      fontWeight: pn === page ? 700 : 400,
                      cursor: pn === page ? 'default' : 'pointer',
                      minWidth: 32
                    }}
                    disabled={pn === page}
                  >{pn}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', background: page === totalPages ? '#f1f5f9' : '#fff', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
              </div>
            )}
          </div>
        </>
      )}
      {/* Per-week, per-code summary table */}
      {filteredRows.length > 0 && codeCol && codeValues.length > 0 && dateCol && (
        <div style={{ marginTop: 32, background: '#f3f4f6', borderRadius: 8, padding: 16, boxShadow: '0 2px 8px #0001' }}>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Points Added Per Week and Code</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #e5e7eb', padding: 8, background: '#f3f4f6', textAlign: 'left' }}>Week</th>
                {codeValues.map((code, i) => (
                  <th key={code} style={{ border: '1px solid #e5e7eb', padding: 8, background: '#f3f4f6', color: getDistinctColor(i, codeValues.length, 70, 45) }}>{code}</th>
                ))}
                <th style={{ border: '1px solid #e5e7eb', padding: 8, background: '#f3f4f6', textAlign: 'left' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Build week->code->count map
                const weekMap = {};
                filteredRows.forEach(row => {
                  const weekKey = getWeekKey(row[dateCol]);
                  const code = row[codeCol];
                  if (!weekKey || !code) return;
                  if (!weekMap[weekKey]) weekMap[weekKey] = {};
                  if (!weekMap[weekKey][code]) weekMap[weekKey][code] = 0;
                  weekMap[weekKey][code]++;
                });
                const weekKeysSorted = Object.keys(weekMap).sort();
                const allCodeTotals = codeValues.map(code => 0);
                let grandTotal = 0;
                const weekRows = weekKeysSorted.map(weekKey => {
                  const codeCounts = codeValues.map((code, i) => {
                    const count = weekMap[weekKey][code] || 0;
                    allCodeTotals[i] += count;
                    grandTotal += count;
                    return count;
                  });
                  const total = codeCounts.reduce((a, b) => a + b, 0);
                  const weekRange = getWeekRange(weekKey);
                  return (
                    <tr key={weekKey}>
                      <td style={{ border: '1px solid #e5e7eb', padding: 8, fontWeight: 600, background: '#f8fafc' }}>
                        <div>{weekKey}</div>
                        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 400, marginTop: 2 }}>{weekRange}</div>
                      </td>
                      {codeCounts.map((count, i) => (
                        <td key={i} style={{ border: '1px solid #e5e7eb', padding: 8, color: count > 0 ? getDistinctColor(i, codeValues.length, 70, 45) : '#aaa', textAlign: 'center', fontWeight: count > 0 ? 600 : 400 }}>{count}</td>
                      ))}
                      <td style={{ border: '1px solid #e5e7eb', padding: 8, fontWeight: 700, background: '#f3f4f6', textAlign: 'center' }}>{total}</td>
                    </tr>
                  );
                });
                // Add totals row
                return [
                  ...weekRows,
                  <tr key="totals">
                    <td style={{ border: '1px solid #e5e7eb', padding: 8, fontWeight: 700, background: '#e0e7ef' }}>Total</td>
                    {allCodeTotals.map((count, i) => (
                      <td key={i} style={{ border: '1px solid #e5e7eb', padding: 8, color: count > 0 ? getDistinctColor(i, codeValues.length, 70, 45) : '#aaa', textAlign: 'center', fontWeight: 700 }}>{count}</td>
                    ))}
                    <td style={{ border: '1px solid #e5e7eb', padding: 8, fontWeight: 900, background: '#e0e7ef', textAlign: 'center' }}>{grandTotal}</td>
                  </tr>
                ];
              })()}
            </tbody>
          </table>
        </div>
      )}
      {/* Leica Project Config UI */}
      <div style={{ marginBottom: 18, background: '#f1f5f9', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Project name..."
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc', minWidth: 180 }}
        />
        <button onClick={handleSaveProject} disabled={isSavingProject || !projectName} style={{ padding: '7px 16px', borderRadius: 4, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: isSavingProject ? 'not-allowed' : 'pointer' }}>Save</button>
        <button onClick={() => handleLoadProject()} disabled={isLoadingProject || !projectName} style={{ padding: '7px 16px', borderRadius: 4, border: '1px solid #2563eb', background: '#fff', color: '#2563eb', fontWeight: 600, cursor: isLoadingProject ? 'not-allowed' : 'pointer' }}>Load</button>
        {projectList.length > 0 && (
          <span style={{ marginLeft: 12, fontSize: 15, color: '#334155' }}>
            Existing Projects:
            {projectList.map(name => (
              <button key={name} onClick={() => handleLoadProject(name)} style={{ marginLeft: 6, padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', background: name === projectName ? '#2563eb' : '#fff', color: name === projectName ? '#fff' : '#222', fontWeight: name === projectName ? 700 : 400, cursor: 'pointer', fontSize: 14 }}>{name}</button>
            ))}
          </span>
        )}
        {projectError && <span style={{ color: projectError === 'Saved!' || projectError === 'Loaded!' ? '#059669' : '#b91c1c', marginLeft: 12 }}>{projectError}</span>}
      </div>
    </div>
  );
};

// Custom polyline component for ScatterChart
function PolylineConnector({ points, color = '#8884d8' }) {
  if (!points || points.length < 2) return null;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return <path d={path} fill="none" stroke={color} strokeWidth={2} opacity={0.7} />;
}

// Add this helper above LeicaModule
function AreaBetweenWeeks({ weekSegments, xAxis, yAxis, codeCol, codeValues, visibleCodes, visibleChartData }) {
  // For each week, find all code polylines, then fill between them
  return (
    <g>
      {weekSegments.map(({ weekKey, color }, idx) => {
        // For this week, get all visible code polylines (sorted by code order)
        const codeLines = (visibleCodes || []).map(code => {
          const pts = visibleChartData
            .filter(d => d.weekKey === weekKey && d[codeCol] === code)
            .sort((a, b) => a.x - b.x);
          return { code, points: pts };
        }).filter(line => line.points.length > 1);
        if (codeLines.length < 2) return null;
        // For each adjacent pair, fill between their polylines
        return codeLines.slice(1).map((line, i) => {
          const prev = codeLines[i];
          // Build polygon: prev points (in order) + curr points (reverse order)
          const polyPoints = [
            ...prev.points.map(p => `${xAxis.scale(p.x)},${yAxis.scale(p.y)}`),
            ...line.points.slice().reverse().map(p => `${xAxis.scale(p.x)},${yAxis.scale(p.y)}`)
          ].join(' ');
          return (
            <polygon
              key={weekKey + '-' + prev.code + '-' + line.code}
              points={polyPoints}
              fill={color}
              opacity={0.13}
              stroke="none"
            />
          );
        });
      })}
    </g>
  );
}

export default LeicaModule;
