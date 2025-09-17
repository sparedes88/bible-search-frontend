import React from 'react';

const PrintableTable = React.forwardRef(({ data, title }, ref) => (
  <div ref={ref} style={{ padding: '20px' }}>
    <h2 style={{ marginBottom: '20px' }}>{title}</h2>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ border: '1px solid #000', padding: '8px' }}>Name</th>
          <th style={{ border: '1px solid #000', padding: '8px' }}>Last Name</th>
          <th style={{ border: '1px solid #000', padding: '8px' }}>Phone</th>
          <th style={{ border: '1px solid #000', padding: '8px' }}>Tags</th>
          <th style={{ border: '1px solid #000', padding: '8px' }}>Added</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={item.id}>
            <td style={{ border: '1px solid #000', padding: '8px' }}>{item.name}</td>
            <td style={{ border: '1px solid #000', padding: '8px' }}>{item.lastName}</td>
            <td style={{ border: '1px solid #000', padding: '8px' }}>{item.phone}</td>
            <td style={{ border: '1px solid #000', padding: '8px' }}>{item.tags?.join(", ") || "-"}</td>
            <td style={{ border: '1px solid #000', padding: '8px' }}>{item.createdAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div style={{ marginTop: '20px', fontSize: '12px' }}>
      Printed on: {new Date().toLocaleString()}
    </div>
  </div>
));

export default PrintableTable;
