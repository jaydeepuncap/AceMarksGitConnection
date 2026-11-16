import React from "react";
import PropTypes from "prop-types";

const Table = ({
                   columns = [],
                   rows = [],
                   filters,
                   hasNextPage = false,
                   hasPreviousPage = false,
                   loading = false,
                   paginate = false,
                   variant = "auto",
                   nextPage,
                   previousPage,
                   ...rest
               }) => {
    return (
        <s-table
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            loading={loading}
            paginate={paginate}
            variant={variant}
            {...rest}
            onNextpage={nextPage}
            onPreviouspage={previousPage}
        >
            {/* Filters Slot */}
            {filters && <div slot="filters">{filters}</div>}

            {/* Header */}
            <s-table-header-row>
                {columns.map((col, index) => (
                    <s-table-header
                        key={index}
                        format={col.format || "base"}
                        listSlot={col.listSlot || "labeled"}
                    >
                        {col.format === "numeric" || col.format === "currency" ? (
                            <div style={{ textAlign: "right" }}>{col.title}</div>
                        ) : (
                            col.title
                        )}
                    </s-table-header>
                ))}
            </s-table-header-row>

            {/* Body */}
            <s-table-body>
                {rows.map((row, rowIndex) => (
                    <s-table-row key={rowIndex} clickDelegate={row.clickDelegate}>
                        {columns.map((col, colIndex) => (
                            <s-table-cell key={colIndex}>
                                {row[col.key]}
                            </s-table-cell>
                        ))}
                    </s-table-row>
                ))}
            </s-table-body>
        </s-table>
    );
};

/* -------------------------------------------------------
   PROP TYPES
------------------------------------------------------- */
Table.propTypes = {
    columns: PropTypes.arrayOf(
        PropTypes.shape({
            title: PropTypes.string.isRequired,
            key: PropTypes.string.isRequired,
            format: PropTypes.oneOf(["base", "numeric", "currency"]),
            listSlot: PropTypes.oneOf([
                "primary",
                "secondary",
                "kicker",
                "inline",
                "labeled",
            ]),
        })
    ).isRequired,

    rows: PropTypes.arrayOf(
        PropTypes.shape({
            clickDelegate: PropTypes.string,
        })
    ).isRequired,

    filters: PropTypes.node,

    // Pagination and states
    hasNextPage: PropTypes.bool,
    hasPreviousPage: PropTypes.bool,
    loading: PropTypes.bool,
    paginate: PropTypes.bool,
    variant: PropTypes.oneOf(["auto", "list", "table"]),

    // Events
    nextPage: PropTypes.func,
    previousPage: PropTypes.func,
};

export default Table;


// <Table
//     paginate={true}
//     hasNextPage={true}
//     columns={[
//         { title: "Name", key: "name" },
//         { title: "Email", key: "email" },
//         { title: "Orders placed", key: "orders", format: "numeric" },
//         { title: "Phone", key: "phone" },
//     ]}
//     rows={[
//         { name: "John Smith", email: "john@example.com", orders: 23, phone: "123-456-7890" },
//         { name: "Jane Johnson", email: "jane@example.com", orders: 15, phone: "234-567-8901" },
//         { name: "Brandon Williams", email: "brandon@example.com", orders: 42, phone: "345-678-9012" },
//     ]}
// />
