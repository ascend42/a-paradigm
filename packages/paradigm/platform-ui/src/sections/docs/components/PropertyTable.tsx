import React from 'react';

interface Entry { key: string; value: string }

export function PropertyTable({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return null;
  return (
    <table className="docs-table docs-table--properties">
      <tbody>
        {entries.map(e => (
          <tr key={e.key}>
            <td className="docs-table__key">{e.key}</td>
            <td className="docs-table__value"><code>{e.value}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
