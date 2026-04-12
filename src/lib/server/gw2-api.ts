const GW2_API_BASE = 'https://api.guildwars2.com/v2';

interface TokenInfo {
	id: string;
	name: string;
	permissions: string[];
}

interface AccountInfo {
	id: string;
	name: string;
	world: number;
	access: string[];
	created: string;
}

export interface Gw2VerifyResult {
	accountId: string;
	accountName: string;
	permissions: string[];
	world: number;
	access: string[];
}

export class Gw2ApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number = 401
	) {
		super(message);
		this.name = 'Gw2ApiError';
	}
}

export async function verifyGw2ApiKey(apiKey: string): Promise<Gw2VerifyResult> {
	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Gw2ApiError('API key is required', 400);
	}

	const headers = { Authorization: `Bearer ${trimmed}` };

	// Step 1: Verify the key and check permissions
	const tokenRes = await fetch(`${GW2_API_BASE}/tokeninfo`, { headers });
	if (!tokenRes.ok) {
		if (tokenRes.status === 401) {
			throw new Gw2ApiError('Invalid API key. Check that the key is correct and not revoked.');
		}
		throw new Gw2ApiError(`GW2 API error (tokeninfo): ${tokenRes.status}`, 502);
	}

	const tokenInfo: TokenInfo = await tokenRes.json();

	if (!tokenInfo.permissions.includes('account')) {
		throw new Gw2ApiError(
			'API key missing required "account" permission. Create a new key with at least the "account" checkbox enabled.',
			400
		);
	}

	// Step 2: Get account identity
	const accountRes = await fetch(`${GW2_API_BASE}/account`, { headers });
	if (!accountRes.ok) {
		throw new Gw2ApiError(`GW2 API error (account): ${accountRes.status}`, 502);
	}

	const account: AccountInfo = await accountRes.json();

	return {
		accountId: account.id,
		accountName: account.name,
		permissions: tokenInfo.permissions,
		world: account.world,
		access: account.access
	};
}
