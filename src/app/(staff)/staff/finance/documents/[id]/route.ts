import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';

/**
 * Open one supporting document.
 *
 * The bucket is private. This checks the viewer may see the books, reads the
 * document record through RLS, and redirects to a signed link that expires in
 * two minutes - so a copied URL is useless by the time it reaches anyone else.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !can(user.role, 'finance.view')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from('finance_documents')
    .select('storage_path, file_name')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { data, error } = await supabase.storage
    .from('finance-documents')
    .createSignedUrl(doc.storage_path, 120);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'The document could not be opened.' }, { status: 502 });
  }

  return NextResponse.redirect(data.signedUrl);
}
