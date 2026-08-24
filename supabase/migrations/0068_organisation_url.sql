-- Adds a website URL to organisations, for the platform-admin provider edit
-- form and the (now built) provider-facing console. Nullable/additive --
-- existing organisations simply have no url until edited.

alter table organisations add column url text;
