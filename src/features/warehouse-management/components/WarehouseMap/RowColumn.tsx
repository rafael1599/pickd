import React from 'react';
import { SublocationSquare } from './SublocationSquare';

export interface SublocationData {
  id: string;
  name: string;
  status: 'empty' | 'partial' | 'full';
}

interface RowColumnProps {
  rowId: string;
  rowName: string;
  sublocations: SublocationData[];
}

export const RowColumn: React.FC<RowColumnProps> = ({ rowName, sublocations }) => {
  return (
    <div className="flex flex-col items-center gap-4 bg-gray-50/80 p-4 pb-8 rounded-2xl border-2 border-gray-100 shadow-sm relative">
      {/* Visual top bar of the rack */}
      <div className="absolute top-0 left-0 right-0 h-3 bg-gray-300 rounded-t-xl" />

      <div className="bg-slate-800 text-white px-8 py-2 mt-4 rounded-md font-bold shadow-md z-10 tracking-widest text-lg">
        {rowName}
      </div>

      <div className="flex flex-col gap-2 relative mt-2">
        {/* Central visual line to look like a rack frame */}
        <div className="absolute left-1/2 top-0 bottom-0 w-2 bg-gray-200 -translate-x-1/2 -z-10" />

        {sublocations.map((sub) => (
          <SublocationSquare
            key={sub.id}
            id={sub.id}
            name={sub.name}
            status={sub.status}
            onClick={() => console.log('Clicked sublocation', sub.name)}
          />
        ))}
      </div>
    </div>
  );
};
