'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { list, projectSummary, requestJson, runSummary, type ProjectSummary, type RunSummary } from '../lib/product-client';

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [market, setMarket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void requestJson('/api/projects').then((data) => {
      if (!active) return;
      const values = list(data.projects).map(projectSummary);
      setProjects(values);
      setSelected(values[0]?.id ?? '');
    }).catch((reason: unknown) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setRuns([]);
    void requestJson(`/api/projects/${encodeURIComponent(selected)}`).then((data) => {
      if (active) setRuns(list(data.runs).map(runSummary));
    }).catch((reason: unknown) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [selected]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await requestJson('/api/projects', { name });
      const project = projectSummary(data.project);
      setProjects((items) => [...items, project]); setSelected(project.id); setName('');
    } catch (reason: unknown) { setError(message(reason)); } finally { setBusy(false); }
  }

  async function startResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await requestJson('/api/research', { projectId: selected, goal, constraints: { ...(market.trim() ? { market: market.trim() } : {}) } });
      if (typeof data.researchRunId !== 'string') throw new Error('Missing research identifier');
      window.location.assign(`/research/${encodeURIComponent(data.researchRunId)}`);
    } catch (reason: unknown) { setError(message(reason)); setBusy(false); }
  }

  return <main>
    <p className="eyebrow">Evidence first</p>
    <h1>Your research projects</h1>
    <p className="intro">Investigate a market, inspect the sources, and decide what to validate next.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="columns">
      <section className="panel"><h2>Create a project</h2>
        <form onSubmit={createProject}>
          <label htmlFor="project-name">Project name</label>
          <input id="project-name" required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} placeholder="Small business operations" />
          <button disabled={busy || !name.trim()}>Create project</button>
        </form>
      </section>
      <section className="panel"><h2>Start research</h2>
        {projects.length === 0 ? <p>Create a project to begin.</p> : <form onSubmit={startResearch}>
          <label htmlFor="research-project">Project</label>
          <select id="research-project" value={selected} onChange={(event) => setSelected(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <label htmlFor="research-goal">Research goal</label>
          <textarea id="research-goal" required maxLength={4000} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Find a software opportunity for US small businesses…" />
          <label htmlFor="research-market">Target market (optional)</label>
          <input id="research-market" maxLength={255} value={market} onChange={(event) => setMarket(event.target.value)} placeholder="US small businesses" />
          <button disabled={busy || !goal.trim() || !selected}>{busy ? 'Starting…' : 'Start research'}</button>
        </form>}
      </section>
    </div>
    <section className="panel"><h2>Research history</h2>
      {runs.length === 0 ? <p>No research runs for this project yet.</p> : <ul className="run-list">{runs.map((run) => <li key={run.id}><Link href={`/research/${run.id}`}>{run.goal}</Link><span className={`status ${run.status}`}>{run.status}</span></li>)}</ul>}
    </section>
  </main>;
}

function message(reason: unknown): string { return reason instanceof Error ? reason.message : 'Request failed'; }
