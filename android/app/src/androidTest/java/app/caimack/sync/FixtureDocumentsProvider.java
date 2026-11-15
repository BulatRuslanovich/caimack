// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.sync;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.Binder;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;

/** SAF fixture in the test APK's private cache. Uses no target APK dependencies. */
public final class FixtureDocumentsProvider extends DocumentsProvider {
    public static final String AUTHORITY = "app.caimack.uitest.sync-fixture";
    private static final String[] COLUMNS = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED };

    private File root() {
        File root = new File(getContext().getCacheDir(), "sync-documents");
        root.mkdirs();
        try { return root.getCanonicalFile(); }
        catch (IOException error) { throw new IllegalStateException(error); }
    }
    private File file(String id) {
        String[] packages = getContext().getPackageManager().getPackagesForUid(Binder.getCallingUid());
        if (packages == null || (!Arrays.asList(packages).contains("app.caimack.uitest") &&
                !Arrays.asList(packages).contains("app.caimack.uitest.test"))) throw new SecurityException();
        try {
            File base = root().getCanonicalFile();
            File file = id.equals("root") ? base : new File(base, id).getCanonicalFile();
            if (!file.equals(base) && !file.getPath().startsWith(base.getPath() + File.separator))
                throw new SecurityException("Outside the test fixture");
            return file;
        } catch (IOException error) { throw new IllegalStateException(error); }
    }
    private String id(File file) {
        return file.equals(root()) ? "root" : file.getPath().substring(root().getPath().length() + 1);
    }
    private void add(MatrixCursor cursor, File file) {
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : cursor.getColumnNames()) {
            Object value;
            switch (column) {
                case Document.COLUMN_DOCUMENT_ID: value = id(file); break;
                case Document.COLUMN_DISPLAY_NAME: value = file.getName(); break;
                case Document.COLUMN_MIME_TYPE: value = file.isDirectory() ? Document.MIME_TYPE_DIR : "application/octet-stream"; break;
                case Document.COLUMN_FLAGS:
                    value = Document.FLAG_SUPPORTS_WRITE | Document.FLAG_SUPPORTS_DELETE | Document.FLAG_SUPPORTS_RENAME |
                        (file.isDirectory() ? Document.FLAG_DIR_SUPPORTS_CREATE : 0); break;
                case Document.COLUMN_SIZE: value = file.length(); break;
                case Document.COLUMN_LAST_MODIFIED: value = file.lastModified(); break;
                default: value = null;
            }
            row.add(column, value);
        }
    }
    @Override public boolean onCreate() { return true; }
    @Override public boolean isChildDocument(String parent, String child) {
        return file(child).getPath().startsWith(file(parent).getPath() + File.separator);
    }
    @Override public Cursor queryRoots(String[] projection) { return new MatrixCursor(new String[] { "root_id" }); }
    @Override public Cursor queryDocument(String documentId, String[] projection) {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection);
        add(cursor, file(documentId));
        return cursor;
    }
    @Override public Cursor queryChildDocuments(String parent, String[] projection, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection);
        File[] children = file(parent).listFiles();
        if (children != null) for (File child : children) add(cursor, child);
        return cursor;
    }
    @Override public ParcelFileDescriptor openDocument(String id, String mode, CancellationSignal signal) throws java.io.FileNotFoundException {
        return ParcelFileDescriptor.open(file(id), ParcelFileDescriptor.parseMode(mode));
    }
    private File child(File parent, String name) {
        if (name.isEmpty() || name.contains("/") || name.equals(".") || name.equals("..")) throw new IllegalArgumentException();
        return new File(parent, name);
    }
    @Override public String createDocument(String parent, String mime, String name) {
        File child = child(file(parent), name);
        try {
            if (!(mime.equals(Document.MIME_TYPE_DIR) ? child.mkdir() : child.createNewFile()))
                throw new IllegalStateException("Cannot create fixture document: " + child);
        } catch (IOException error) { throw new IllegalStateException(error); }
        return id(child);
    }
    @Override public String renameDocument(String id, String name) {
        File from = file(id);
        File to = child(from.getParentFile(), name);
        if (to.exists() || !from.renameTo(to)) throw new IllegalStateException();
        return id(to);
    }
    private void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        if (!file.delete()) throw new IllegalStateException();
    }
    @Override public void deleteDocument(String id) { delete(file(id)); }
}
