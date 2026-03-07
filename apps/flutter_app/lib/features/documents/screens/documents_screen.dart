import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:file_picker/file_picker.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/providers/auth_provider.dart';
import '../../../data/api/api_client.dart';
import '../../../core/widgets/app_shell.dart';

class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});
  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  List<Map<String, dynamic>> _documents = [];
  bool _loading = true;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final res = await api.getDocuments(orgId);
      final raw = res.data;
      List data;
      if (raw is Map<String, dynamic>) {
        final inner = raw['data'];
        if (inner is List) {
          data = inner;
        } else if (inner is Map && inner['documents'] is List) {
          data = inner['documents'] as List;
        } else {
          data = [];
        }
      } else if (raw is List) {
        data = raw;
      } else {
        data = [];
      }
      if (mounted) {
        setState(() {
          _documents = data.whereType<Map<String, dynamic>>().toList();
          _loading = false;
        });
      }
    } catch (e) {
      debugPrint('Documents load error: $e');
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickAndUploadFile() async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;

    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      allowMultiple: false,
    );

    if (result == null || result.files.isEmpty) return;
    final file = result.files.first;
    final filePath = file.path;
    if (filePath == null) return;

    setState(() {
      _uploading = true;
    });

    try {
      await api.uploadDocument(orgId, filePath);
      if (mounted) {
        setState(() {
          _uploading = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${file.name} uploaded successfully'),
            backgroundColor: AppColors.success,
          ),
        );
        _loadDocuments(); // Refresh the list
      }
    } catch (_) {
      if (mounted) {
        setState(() => _uploading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to upload file'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  Future<void> _deleteDocument(String docId) async {
    final orgId = ref.read(authProvider).currentOrgId;
    if (orgId == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Document'),
        content: const Text('Are you sure you want to delete this document?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await api.deleteDocument(orgId, docId);
      _loadDocuments();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to delete document'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  IconData _iconForType(String? type) {
    switch (type?.toLowerCase()) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'image':
      case 'png':
      case 'jpg':
      case 'jpeg':
        return Icons.image;
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'xls':
      case 'xlsx':
        return Icons.table_chart;
      default:
        return Icons.insert_drive_file;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: MediaQuery.of(context).size.width < 1024
            ? IconButton(
                icon: const Icon(Icons.menu, color: AppColors.highlight),
                onPressed: () => AppShell.openDrawer(),
              )
            : null,
        title: const Text('Documents'),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _uploading ? null : _pickAndUploadFile,
        backgroundColor: AppColors.highlight,
        child: _uploading
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Icon(Icons.upload_file, color: Colors.white),
      ),
      body: Column(
        children: [
          // Upload progress bar
          if (_uploading)
            LinearProgressIndicator(
              backgroundColor: AppColors.surfaceAlt,
              color: AppColors.highlight,
            ),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: AppColors.highlight,
                    ),
                  )
                : _documents.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.folder_open,
                          size: 64,
                          color: AppColors.textLight,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Text(
                          'No documents yet',
                          style: AppTypography.bodySmall,
                        ),
                      ],
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _loadDocuments,
                    child: ListView.builder(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: _documents.length,
                      itemBuilder: (_, i) {
                        final doc = _documents[i];
                        final name =
                            doc['original_filename']?.toString() ??
                            doc['name']?.toString() ??
                            doc['title']?.toString() ??
                            'Untitled';
                        final type =
                            doc['type']?.toString() ??
                            doc['file_type']?.toString() ??
                            doc['category']?.toString();
                        final url =
                            doc['url']?.toString() ??
                            doc['file_url']?.toString() ??
                            doc['file_path']?.toString();
                        final docId = doc['id']?.toString();
                        return Card(
                          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: AppColors.highlightSubtle,
                              child: Icon(
                                _iconForType(type),
                                color: AppColors.highlight,
                                size: 20,
                              ),
                            ),
                            title: Text(name, style: AppTypography.body),
                            subtitle: type != null
                                ? Text(
                                    type.toUpperCase(),
                                    style: AppTypography.caption,
                                  )
                                : null,
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (url != null)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.download,
                                      color: AppColors.textSecondary,
                                    ),
                                    onPressed: () => launchUrl(
                                      Uri.parse(url),
                                      mode: LaunchMode.externalApplication,
                                    ),
                                  ),
                                if (docId != null)
                                  IconButton(
                                    icon: const Icon(
                                      Icons.delete_outline,
                                      color: AppColors.error,
                                      size: 20,
                                    ),
                                    onPressed: () => _deleteDocument(docId),
                                  ),
                              ],
                            ),
                            onTap: () {
                              if (url != null) {
                                launchUrl(
                                  Uri.parse(url),
                                  mode: LaunchMode.externalApplication,
                                );
                              }
                            },
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
