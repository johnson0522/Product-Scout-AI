import { ResearchWorkspace } from '../../../components/ResearchWorkspace';

export default function ResearchRunPage({ params }: { readonly params: { readonly id: string } }) {
  return <ResearchWorkspace runId={params.id} />;
}
