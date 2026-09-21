'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** Calls POST /api/matches/[id]/complete, then re-reads the page. */
export function CompleteMatchButton({ matchId }: { matchId: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function complete() {
    setPending(true);
    try {
      const res = await fetch(`/api/matches/${matchId}/complete`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not complete the match.');
      toast('success', 'Match marked completed. You can now rate your teammates.');
      router.refresh();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not complete the match.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button onClick={complete} loading={pending}>
      <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
      Mark completed
    </Button>
  );
}
