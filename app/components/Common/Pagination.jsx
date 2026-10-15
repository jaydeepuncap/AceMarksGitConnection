import React, { useEffect, useState } from 'react';

import { Button, Heading, NumberField, Stack, Text } from '../ui';

const Pagination = ({ currentPage, onPageChange, paginationState, disabled, borderRadius = 'none', border = 'none', borderWidth = 'none' }) => {
    const [tempPage, setTempPage] = useState(String(currentPage || ''));

    useEffect(() => {
        setTempPage(String(currentPage || ''));
    }, [currentPage]);

    useEffect(() => {
        if (!tempPage || disabled) return;

        const handler = setTimeout(() => {
            onUpdatePage("GO_TO", tempPage);
        }, 700);

        return () => clearTimeout(handler);
    }, [tempPage]);

    const onUpdatePage = (key, value = null) => {
        if (disabled) return;

        let page = Number(currentPage);

        if (key === 'PREV') {
            page = page > 1 ? page - 1 : 1;
        }
        if (key === 'NEXT') {
            page = page < paginationState?.totalPages ? page + 1 : paginationState?.totalPages;
        }
        if (key === 'GO_TO') {
            const num = Number(value);
            if (!isNaN(num)) {
                page = Math.min(Math.max(num, 1), paginationState?.totalPages || 1);
            }
        }

        if (Number(currentPage) !== Number(page) && page !== undefined) {
            onPageChange(page);
        }
    };

    const hasNext = !disabled && paginationState?.nextPage && currentPage < paginationState?.totalPages;
    const hasPrevious = !disabled && Number(currentPage) !== 1;


    const PAGINATION_BUTTONS = [
        {
            label: '',
            icon: 'arrow-left',
            onClick: () => onUpdatePage('PREV'),
            disabled: disabled || !hasPrevious,
            variant: 'secondary',
            name: 'PREV',
        },
        {
            label: '',
            icon: 'arrow-right',
            onClick: () => onUpdatePage('NEXT'),
            disabled: disabled || !hasNext,
            variant: 'secondary',
            name: 'NEXT',
        },
    ];

    return (
        <Stack direction="inline" gap="small" justifyContent="space-between" paddingBlock='small' paddingInline='base' background='subdued' alignItems="center" borderRadius={borderRadius} border={border} borderWidth={borderWidth}>
            <Heading>{paginationState?.total} items</Heading>
            <Stack direction="inline" gap="small" alignItems="center">
                <Stack direction="inline" gap="small-300" justifyContent="center" alignItems="center" alignContent="center">
                    <Text type='strong'>Page {currentPage}/{paginationState?.totalPages}</Text>
                    {(PAGINATION_BUTTONS || []).map((button, index) => (
                        <Button key={`${index}_${button.name}`} onClick={button.onClick} disabled={button.disabled} icon={button.icon} variant={'secondary'} name={button.name}>
                            {button.label ? button.label : ''}
                        </Button>
                    ))}
                </Stack>

                <Stack direction="inline" gap="small" justifyContent="center" alignItems="center" alignContent="center">
                    <Text>Go to</Text>
                    <div className='PaginationGoTOPage'>
                        <NumberField
                            autoComplete="off"
                            value={String(tempPage || '')}
                            onChange={(e) => setTempPage(e?.target?.value)}
                            onInput={(e) => setTempPage(e?.target?.value)}
                            disabled={disabled}
                            name="GO_TO"
                            id="GO_TO"
                            max={paginationState?.totalPages}
                            min={1}
                        />
                    </div>
                    <Text>Page</Text>
                </Stack>
            </Stack>
        </Stack>
    );
};

export default React.memo(Pagination);
