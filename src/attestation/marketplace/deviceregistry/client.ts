import Config from '../../../../config/attestation.config';
import { userHeaders } from '@attestation/client/userSession';
import type { StockSellingDeviceSubmission } from '@attestation/shared/wire';

export const submitNativeStockSellingDevice = async (
  submission: Omit<StockSellingDeviceSubmission, 'source'>,
): Promise<unknown> => {
  const response = await fetch(
    `${Config.serverBaseUrl}/marketplace/deviceregistry/stock-selling`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...userHeaders() },
      body: JSON.stringify({
        ...submission,
        source: 'androidNative',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Stock-selling device submission failed with HTTP ${response.status}`,
    );
  }
  return response.json();
};
