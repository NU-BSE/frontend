/**
 * The non-negotiable privacy boundary of the Content Engine.
 *
 * `localProcessingOnly` and the two `false` fields are invariants — they must
 * never become configurable in production. Document content is processed on
 * the device; connectors transport bytes only between the device and the
 * user's chosen source provider; first-party/third-party processing upload is
 * forbidden.
 */
export interface DataBoundaryPolicy {
  /** User content must be processed on this device. */
  localProcessingOnly: true;

  /** Connector APIs may transport data between the device and the user's source provider. */
  allowProviderTransport: boolean;

  /** User document content must not be uploaded to creepy.im for processing. */
  allowFirstPartyProcessingUpload: false;

  /** Private content must not be sent to external AI APIs. */
  allowThirdPartyAi: false;
}

export const DEFAULT_DATA_BOUNDARY_POLICY: DataBoundaryPolicy = {
  localProcessingOnly: true,
  allowProviderTransport: true,
  allowFirstPartyProcessingUpload: false,
  allowThirdPartyAi: false,
};
