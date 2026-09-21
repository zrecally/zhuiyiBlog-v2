import { useEffect, useState } from 'react';

type Compliance = {
  enabled: true;
  icpNumber: string;
  policeNumber: string;
  policeRecordCode: string;
};

export const StaticComplianceFooter = ({
  source = '/data/live/site-compliance.json',
  inline = false,
  leadingSeparator = false,
}: {
  source?: string;
  inline?: boolean;
  leadingSeparator?: boolean;
}) => {
  const [value, setValue] = useState<Compliance | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(source, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(payload => {
        const item = payload?.data as Compliance | undefined;
        if (item?.enabled === true && /^\d{6,32}$/.test(item.policeRecordCode)
          && item.icpNumber && item.policeNumber) setValue(item);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [source]);

  if (!value) return null;
  const content = (
    <>
      {leadingSeparator && <span aria-hidden="true">|</span>}
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{value.icpNumber}</a>
      <span aria-hidden="true">|</span>
      <a className="inline-flex items-center gap-1" href={`https://beian.mps.gov.cn/#/query/webSearch?code=${value.policeRecordCode}`} target="_blank" rel="noopener noreferrer">
        <img alt="公安备案" className="h-4 w-4" src="/police-beian.svg" />
        {value.policeNumber}
      </a>
    </>
  );

  return inline
    ? content
    : <div className="flex flex-wrap items-center justify-center gap-3 pb-8 text-[11px] text-xianxia-text/55">{content}</div>;
};
