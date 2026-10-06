'use client';

import { useState } from 'react';
import { Button, Input } from '@product-scout/ui';

export function ResearchForm() {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: Implement research submission
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Research Topic"
        placeholder="Enter your research topic..."
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <Button type="submit" loading={loading}>
        Start Research
      </Button>
    </form>
  );
}
