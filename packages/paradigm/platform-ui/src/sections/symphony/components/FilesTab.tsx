/**
 * FilesTab — File request list with approve/deny actions
 */

import { useState } from 'react';
import { useSymphonyStore, type FileRequestInfo } from '../store/symphonyStore';

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FileRequestCard({ request }: { request: FileRequestInfo }) {
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const handleFileAction = useSymphonyStore(s => s.handleFileAction);

  const isPending = request.status === 'pending';

  return (
    <div className="file-request-card">
      <div className="file-request-header">
        <span className="file-request-path">
          {request.filePath}
          {request.urgency === 'urgent' && (
            <span className="urgency-badge urgent">urgent</span>
          )}
        </span>
        <span className={`file-request-status ${request.status}`}>{request.status}</span>
      </div>
      <div className="file-request-requester">
        From: {request.requester.name}
      </div>
      <div className="file-request-body">{request.reason}</div>
      {request.snippet && (
        <div className="file-request-snippet">Snippet: {request.snippet}</div>
      )}
      <div className="file-request-meta">
        <span>{relativeTime(request.createdAt)}</span>
        {request.resolvedAt && <span>Resolved {relativeTime(request.resolvedAt)}</span>}
        {request.denyReason && <span>Reason: {request.denyReason}</span>}
      </div>
      {isPending && (
        <div className="file-request-actions">
          <button
            className="file-action-btn approve"
            onClick={() => handleFileAction(request.requestId, 'approve')}
          >
            Approve
          </button>
          <button
            className="file-action-btn approve-redacted"
            onClick={() => handleFileAction(request.requestId, 'approve-redacted')}
          >
            Approve (redacted)
          </button>
          {!showDenyInput ? (
            <button
              className="file-action-btn deny"
              onClick={() => setShowDenyInput(true)}
            >
              Deny
            </button>
          ) : (
            <>
              <input
                className="deny-reason-input"
                value={denyReason}
                onChange={e => setDenyReason(e.target.value)}
                placeholder="Reason for denial..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleFileAction(request.requestId, 'deny', denyReason || undefined);
                    setShowDenyInput(false);
                    setDenyReason('');
                  }
                  if (e.key === 'Escape') {
                    setShowDenyInput(false);
                    setDenyReason('');
                  }
                }}
                autoFocus
              />
              <button
                className="file-action-btn deny"
                onClick={() => {
                  handleFileAction(request.requestId, 'deny', denyReason || undefined);
                  setShowDenyInput(false);
                  setDenyReason('');
                }}
              >
                Confirm Deny
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function FilesTab() {
  const fileRequests = useSymphonyStore(s => s.fileRequests);
  const fileFilter = useSymphonyStore(s => s.fileFilter);
  const setFileFilter = useSymphonyStore(s => s.setFileFilter);

  const filters: Array<{ id: 'pending' | 'all'; label: string }> = [
    { id: 'pending', label: 'Pending' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div className="files-view">
      <div className="files-toolbar">
        <div className="files-filter-group">
          {filters.map(f => (
            <button
              key={f.id}
              className={`thread-filter-btn ${fileFilter === f.id ? 'active' : ''}`}
              onClick={() => setFileFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="files-count">{fileRequests.length} request{fileRequests.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="files-list">
        {fileRequests.length === 0 ? (
          <div className="files-empty">
            <p>No file requests.</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>
              Agents request files via <code>paradigm_symphony_request_file</code>
            </p>
          </div>
        ) : (
          fileRequests.map(req => (
            <FileRequestCard key={req.requestId} request={req} />
          ))
        )}
      </div>
    </div>
  );
}
