import { supabase } from '../db';

export async function addGoal(
  userId: string,
  title: string,
  type: 'monthly' | 'yearly' | 'custom',
  targetDate: string,
  description?: string,
  milestones?: string[]
) {
  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: userId,
      title,
      type,
      target_date: targetDate,
      description: description || null,
    })
    .select()
    .single();

  if (error) throw error;

  if (milestones && milestones.length > 0) {
    await supabase.from('goal_milestones').insert(
      milestones.map(m => ({ goal_id: data.id, title: m }))
    );
  }

  return data;
}

export async function getActiveGoals(userId: string) {
  const { data } = await supabase
    .from('goals')
    .select('*, goal_milestones(*)')
    .eq('user_id', userId)
    .eq('status', 'in_progress')
    .order('target_date', { ascending: true });

  return data ?? [];
}

export async function updateGoalProgress(id: string, userId: string, progress: number) {
  const { error } = await supabase
    .from('goals')
    .update({ progress: Math.min(100, Math.max(0, progress)) })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function completeMilestone(milestoneId: string) {
  const { error } = await supabase
    .from('goal_milestones')
    .update({ done: true })
    .eq('id', milestoneId);

  if (error) throw error;
}
