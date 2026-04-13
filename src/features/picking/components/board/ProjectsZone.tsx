import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

interface ProjectTask {
  id: string;
  title: string;
  note: string | null;
}

export const ProjectsZone: React.FC = () => {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['project-tasks', 'in-progress'],
    queryFn: async (): Promise<ProjectTask[]> => {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('id, title, note')
        .eq('status', 'in_progress')
        .order('position', { ascending: true })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as ProjectTask[];
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={16} className="animate-spin text-indigo-400 opacity-40" />
      </div>
    );
  }

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-1">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="p-2.5 rounded-xl bg-card border border-indigo-500/10"
        >
          <p className="text-[11px] font-bold text-content leading-tight">
            {task.title}
          </p>
          {task.note && (
            <p className="text-[9px] text-muted mt-0.5 leading-tight line-clamp-2">
              {task.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
};
